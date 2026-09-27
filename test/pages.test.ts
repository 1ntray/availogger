import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import type { PagesEnv } from '../backend/env';
import { createTestDatabase, seedCredential, testEncryptionKey, grantAvailability } from './d1-fixture';

const baseTime = new Date('2026-09-26T12:00:00Z');
let token: string;
let otherToken: string;
let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let jwk: JWK;
let values: Map<string, string>;
let cache: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
let env: PagesEnv;
const upstream = vi.fn();

beforeAll(async () => {
  fixture = await createTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(baseTime);
  const pair = await generateKeyPair('RS256');
  jwk = { ...await exportJWK(pair.publicKey), kid: 'pages-test', alg: 'RS256' };
  token = await new SignJWT({ type: 'app', email: 'student@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'pages-test' })
    .setIssuer('https://pages-test.cloudflareaccess.com').setAudience('pages-app').setSubject('student-id')
    .setIssuedAt().setExpirationTime('7d').sign(pair.privateKey);
  otherToken = await new SignJWT({ type: 'app', email: 'student@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'pages-test' })
    .setIssuer('https://pages-test.cloudflareaccess.com').setAudience('pages-app').setSubject('other-student-id')
    .setIssuedAt().setExpirationTime('7d').sign(pair.privateKey);
});
beforeEach(async () => {
  vi.resetModules();
  vi.setSystemTime(baseTime);
  values = new Map();
  cache = {
    get: vi.fn(async (key: string) => values.has(key) ? JSON.parse(values.get(key)!) : null),
    put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
  };
  await fixture.db.prepare('DELETE FROM users').run();
  const user = await seedCredential(fixture.db);
  await grantAvailability(fixture.db, user.id);
  env = { DB: fixture.db, FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY: testEncryptionKey, AVAILABILITY_CACHE: cache as unknown as KVNamespace,
    CF_ACCESS_TEAM_DOMAIN: 'pages-test.cloudflareaccess.com', CF_ACCESS_AUD: 'pages-app' };
  upstream.mockReset();
  upstream.mockImplementation(async () => new Response(JSON.stringify({ data: { users: {
    nodes: [{ id: '1', firstName: 'Test', lastName: 'Instructor', callSign: '',
      availabilities: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }],
    pageInfo: { hasNextPage: false, endCursor: null },
  } } })));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://pages-test.cloudflareaccess.com/cdn-cgi/access/certs') return new Response(JSON.stringify({ keys: [jwk] }));
    if (url === 'https://api.flightlogger.net/graphql') return upstream(input, init);
    throw new Error('Unexpected external request in test');
  });
});
afterAll(async () => { vi.unstubAllGlobals(); vi.useRealTimers(); await fixture?.dispose(); });

async function request(path = '/api/availability?from=2026-09-01&to=2026-10-31', authenticated = true, method = 'GET', init: RequestInit = {}) {
  const { onRequest: middleware } = await import('../functions/api/_middleware');
  const { onRequest: availability } = await import('../functions/api/availability');
  const { onRequest: dutyOps } = await import('../functions/api/duty-ops');
  const { onRequest: me } = await import('../functions/api/me');
  const { onRequest: unknown } = await import('../functions/api/[[path]]');
  const { onRequest: onboarding } = await import('../functions/api/onboarding/flightlogger');
  const req = new Request(`https://student.luftfartsfag.no${path}`, { ...init, method,
    headers: { ...(authenticated ? { 'Cf-Access-Jwt-Assertion': token } : {}), ...init.headers } });
  const data = {};
  const handler = path.startsWith('/api/availability') ? availability : path.startsWith('/api/duty-ops') ? dutyOps : path === '/api/me' ? me : path.startsWith('/api/onboarding/flightlogger') ? onboarding : unknown;
  const context = { request: req, env, data, next: () => handler(context as never) };
  return middleware(context as never);
}

describe('Pages Functions API with Access middleware', () => {
  it.each(['DENY', 'NO_ROLE'])('enforces Duty Ops permission before credentials or synchronization: %s', async access => {
    const userId = await fixture.db.prepare('SELECT id FROM users WHERE access_subject = ?').bind('student-id').first<string>('id');
    if (access === 'DENY') {
      await fixture.db.prepare(`INSERT INTO user_permission_overrides (user_id, permission_key, effect, created_at, updated_at)
        VALUES (?, 'duty_ops.view', 'DENY', 'test', 'test')`).bind(userId).run();
    } else {
      await fixture.db.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(userId).run();
    }
    await fixture.db.prepare('DELETE FROM flightlogger_credentials').run();
    const shiftsBefore = await fixture.db.prepare('SELECT COUNT(*) FROM duty_ops_shifts').first<number>('COUNT(*)');
    const denied = await request('/api/duty-ops?from=bad&to=bad');
    expect(denied.status).toBe(403);
    expect(denied.headers.get('Cache-Control')).toBe('no-store');
    expect(await denied.json()).toEqual({ error: 'You do not have access to this feature.', code: 'FORBIDDEN' });
    expect(upstream).not.toHaveBeenCalled();
    expect(await fixture.db.prepare('SELECT COUNT(*) FROM duty_ops_shifts').first<number>('COUNT(*)')).toBe(shiftsBefore);
    await fixture.db.prepare(`INSERT INTO user_permission_overrides (user_id, permission_key, effect, created_at, updated_at)
      VALUES (?, 'duty_ops.view', 'ALLOW', 'test', 'test') ON CONFLICT (user_id, permission_key) DO UPDATE SET effect = 'ALLOW'`).bind(userId).run();
    expect((await request('/api/duty-ops?from=bad&to=bad')).status).toBe(400);
  });
  it('protects Duty Ops with Access, onboarding, validation and read-only methods', async () => {
    expect((await request('/api/duty-ops', false)).status).toBe(401);
    expect((await request('/api/duty-ops', true, 'POST')).status).toBe(405);
    expect((await request('/api/duty-ops?user_id=another')).status).toBe(400);
    expect((await request('/api/duty-ops?from=bad&to=bad')).status).toBe(400);
    await fixture.db.prepare('DELETE FROM flightlogger_credentials').run();
    const missing = await request('/api/duty-ops');
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ code: 'ONBOARDING_REQUIRED' });
    expect(upstream).not.toHaveBeenCalled();
  });
  it('returns normalized Duty Ops using only the verified current user and safe errors', async () => {
    upstream.mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body);
      return body.query.includes('CurrentUserProfile') ? Response.json({ data: { user: { id: 'fl-student', firstName: 'Simon', lastName: null } } })
        : Response.json({ data: { bookings: { nodes: [{ __typename: 'MeetingBooking', id: 'booking', startsAt: '2026-09-28T05:00:00Z', endsAt: '2026-09-28T12:00:00Z', status: 'OPEN', externalReference: null,
          classroom: { id: '852', name: 'DUTY OPS' }, participants: [null, null, null] }], pageInfo: { hasNextPage: false, endCursor: null } } } });
    });
    const response = await request('/api/duty-ops', true, 'GET', { headers: { 'Cf-Access-Authenticated-User-Email': 'forged@test' } });
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const text = await response.text();
    expect(text).not.toMatch(/test-token|ciphertext|iv|fl-student|forged|externalReference|participantsById/);
    expect(JSON.parse(text)).toMatchObject({ timeZone: 'Europe/Oslo', sync: { stale: false }, shifts: [{ participantCount: 3, participants: [{ firstName: 'Simon', isCurrentUser: true }] }] });
    expect(cache.get).not.toHaveBeenCalled();
    const original = token;
    try {
      token = otherToken;
      expect((await request('/api/duty-ops')).status).toBe(409);
    } finally { token = original; }
  });
  it('sanitizes Duty Ops refresh errors without an existing snapshot and preserves 429 cooldown', async () => {
    upstream.mockResolvedValue(new Response('secret upstream body', { status: 429, headers: { 'Retry-After': '15' } }));
    const response = await request('/api/duty-ops');
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('15');
    expect(await response.text()).not.toMatch(/secret upstream|test-token/);
    expect((await request('/api/duty-ops')).status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('requires Access even without Origin and before reading any cache', async () => {
    const response = await request(undefined, false);
    expect(response.status).toBe(401);
    expect(cache.get).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
    await request(); // warm cache
    expect((await request(undefined, false)).status).toBe(401);
  });

  it('fails closed when Access, D1 or encryption configuration is absent', async () => {
    env.CF_ACCESS_AUD = '';
    expect((await request()).status).toBe(503);
    expect(cache.get).not.toHaveBeenCalled();
    env.CF_ACCESS_AUD = 'pages-app';
    env.DB = undefined;
    expect((await request()).status).toBe(503);
    env.DB = fixture.db;
    env.FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY = '';
    expect((await request()).status).toBe(503);
  });

  it('rejects an invalid Access token before touching KV or FlightLogger', async () => {
    const valid = token;
    token = 'not-a-jwt';
    try {
      expect((await request()).status).toBe(401);
      expect(cache.get).not.toHaveBeenCalled();
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      token = valid;
    }
  });

  it('returns a same-origin calendar with a preserved hot-cache timestamp', async () => {
    const first = await request();
    expect(first.status).toBe(200);
    expect(first.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    const body = await first.json() as { cachedAt: string; instructors: { days: string[] }[] };
    expect(body).toMatchObject({ from: '2026-09-01', to: '2026-10-31', timeZone: 'Europe/Oslo', cachedAt: baseTime.toISOString() });
    expect(body.instructors[0].days).toHaveLength(61);
    vi.setSystemTime(new Date(baseTime.getTime() + 30_000));
    expect((await (await request()).json() as { cachedAt: string }).cachedAt).toBe(body.cachedAt);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledWith(expect.stringMatching(/^availability:v1:[a-f0-9]{64}:/), expect.any(String), { expirationTtl: 86400 });
  });

  it('reuses persisted KV after restart and refreshes it at 24 hours', async () => {
    const first = await (await request()).json();
    vi.resetModules();
    vi.setSystemTime(new Date(baseTime.getTime() + 60_000));
    expect(await (await request()).json()).toEqual(first);
    expect(upstream).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(baseTime.getTime() + 86_400_000));
    expect((await (await request()).json() as { cachedAt: string }).cachedAt).toBe('2026-09-27T12:00:00.000Z');
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it.each([
    '?from=2026-02-30&to=2026-03-01', '?from=2026-01-01&to=2026-04-01',
    '?from=2026-09-02&to=2026-09-01', '?from=2026-09-01&to=2026-09-02&refresh=true',
    '?from=2026-09-01&from=2026-09-02&to=2026-09-03',
  ])('rejects invalid dates/ranges/parameters %s', async query => {
    expect((await request(`/api/availability${query}`)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('has no GraphQL proxy, public instructors route, or cross-origin preflight', async () => {
    expect((await request('/api/instructors')).status).toBe(404);
    expect((await request(undefined, true, 'POST')).status).toBe(405);
    const options = await request(undefined, true, 'OPTIONS');
    expect(options.status).toBe(405);
    expect(options.headers.get('Access-Control-Allow-Headers')).toBeNull();
  });

  it('returns only verified identity and safe application state from /api/me', async () => {
    expect(await (await request('/api/me')).json()).toEqual({ email: 'student@example.test', subject: 'student-id',
      onboardingComplete: true, hasFlightLoggerCredential: true, flightLoggerUserId: 'fl-student',
      roles: ['STUDENT'], permissions: ['availability.view', 'duty_ops.view', 'transport.view'] });
    expect((await request('/api/me', false)).status).toBe(401);
  });
  it('bootstraps only a matching verified Access subject and never an invalid JWT or email header', async () => {
    env.PORTAL_BOOTSTRAP_ADMIN_SUBJECT = 'student-id';
    const valid = token;
    token = 'forged';
    try {
      expect((await request('/api/me')).status).toBe(401);
      expect(await fixture.db.prepare("SELECT 1 FROM user_roles WHERE role_id = 'system-admin'").first()).toBeNull();
    } finally { token = valid; }
    const response = await request('/api/me');
    expect(await response.json()).toMatchObject({ roles: ['ADMIN', 'STUDENT'], permissions: expect.arrayContaining(['admin.manage_permissions']) });
    expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM authorization_audit_log WHERE target_user_id IS NOT NULL').first('count')).toBe(1);
  });

  it('creates an authenticated application user and enforces onboarding independently of the frontend', async () => {
    await fixture.db.prepare('DELETE FROM users').run();
    const me = await request('/api/me');
    expect(await me.json()).toEqual({ email: 'student@example.test', subject: 'student-id',
      onboardingComplete: false, hasFlightLoggerCredential: false, flightLoggerUserId: null,
      roles: ['STUDENT'], permissions: ['duty_ops.view', 'transport.view'] });
    expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM users').first('count')).toBe(1);
    const userId = await fixture.db.prepare('SELECT id FROM users').first<string>('id');
    await grantAvailability(fixture.db, userId!);
    const missing = await request();
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ code: 'ONBOARDING_REQUIRED' });
    expect(upstream).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('ignores the old shared token and separates two Access users and token-hashed caches', async () => {
    Object.assign(env, { FLIGHTLOGGER_API_TOKEN: 'obsolete-shared-token' });
    const other = await seedCredential(fixture.db, 'other-student-id', 'other-personal-token');
    await grantAvailability(fixture.db, other.id);
    upstream.mockImplementation(async (_url, init) => {
      const account = init.headers.Authorization === 'Bearer test-token' ? 'instructor-a' : 'instructor-b';
      return Response.json({ data: { users: { nodes: [{ id: account, firstName: 'Instructor', lastName: '', callSign: '',
        availabilities: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }], pageInfo: { hasNextPage: false, endCursor: null } } } });
    });
    const first = await request(undefined, true, 'GET', { headers: { 'Cf-Access-Authenticated-User-Email': 'forged@example.test' } });
    expect(await first.json()).toMatchObject({ instructors: [{ id: 'instructor-a' }] });
    const original = token;
    try {
      token = otherToken;
      expect(await (await request()).json()).toMatchObject({ instructors: [{ id: 'instructor-b' }] });
      expect(await (await request('/api/me')).json()).toMatchObject({ subject: 'other-student-id' });
    } finally { token = original; }
    expect(upstream.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual(['Bearer test-token', 'Bearer other-personal-token']);
    expect(values.size).toBe(2);
    for (const key of values.keys()) {
      expect(key).toMatch(/^availability:v1:[a-f0-9]{64}:/);
      expect(key).not.toMatch(/student|personal|token|@/);
    }
  });

  it('requires Access on credential POSTs and sanitizes internal D1 exceptions', async () => {
    expect((await request('/api/onboarding/flightlogger', false, 'POST')).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
    env.DB = { prepare: () => { throw new Error('D1 private ciphertext / submitted-token'); } } as unknown as D1Database;
    const response = await request('/api/me');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/ciphertext|submitted-token/);
  });

  it('returns safe connect metadata and refreshed onboarding state without credential material', async () => {
    upstream.mockImplementation(async () => Response.json({ data: { user: { id: 'personal-user' } } }));
    const response = await request('/api/onboarding/flightlogger', true, 'POST', { headers: { 'Content-Type': 'application/json', Origin: 'https://student.luftfartsfag.no' }, body: JSON.stringify({ apiKey: 'new-personal-key' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ connected: true, flightLoggerUserId: 'personal-user' });
    const me = await request('/api/me');
    expect(await me.json()).toEqual({ email: 'student@example.test', subject: 'student-id', onboardingComplete: true,
      hasFlightLoggerCredential: true, flightLoggerUserId: 'personal-user',
      roles: ['STUDENT'], permissions: ['availability.view', 'duty_ops.view', 'transport.view'] });
  });

  it.each([
    [{}, 400], [{ apiKey: '' }, 400], [{ apiKey: '  ' }, 400], [{ apiKey: 'a b' }, 400], [{ apiKey: 'x'.repeat(4097) }, 400],
    [{ apiKey: 'key', user_id: 'someone-else' }, 400], [{ apiKey: 'key', email: 'victim@example.test' }, 400],
    [['key'], 400], [null, 400],
  ])('rejects malformed or identity-selecting credential body %#', async (body, status) => {
    expect((await request('/api/onboarding/flightlogger', true, 'POST', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(status);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON, non-JSON bodies, oversized streams and cross-origin credential writes', async () => {
    expect((await request('/api/onboarding/flightlogger', true, 'POST', { headers: { 'Content-Type': 'application/json' }, body: '{invalid' })).status).toBe(400);
    expect((await request('/api/onboarding/flightlogger', true, 'POST', { body: 'apiKey=key' })).status).toBe(415);
    expect((await request('/api/onboarding/flightlogger', true, 'POST', { headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(8193) })).status).toBe(413);
    expect((await request('/api/onboarding/flightlogger', true, 'POST', { headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' }, body: '{"apiKey":"key"}' })).status).toBe(403);
    expect((await request('/api/onboarding/flightlogger?user_id=other', true, 'POST', { headers: { 'Content-Type': 'application/json' }, body: '{"apiKey":"key"}' })).status).toBe(400);
    expect((await request('/api/onboarding/flightlogger', true, 'GET')).status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('preserves FlightLogger rate limits and the cooldown', async () => {
    upstream.mockImplementation(async () => new Response('', { status: 429, headers: { 'Retry-After': '45' } }));
    const first = await request();
    expect(first.status).toBe(429);
    expect(first.headers.get('Retry-After')).toBe('45');
    expect((await request()).status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(cache.put).not.toHaveBeenCalled();
  });
});
