import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import type { PagesEnv } from '../backend/env';

const baseTime = new Date('2026-09-26T12:00:00Z');
let token: string;
let jwk: JWK;
let values: Map<string, string>;
let cache: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
let env: PagesEnv;
const upstream = vi.fn();

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(baseTime);
  const pair = await generateKeyPair('RS256');
  jwk = { ...await exportJWK(pair.publicKey), kid: 'pages-test', alg: 'RS256' };
  token = await new SignJWT({ type: 'app', email: 'student@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'pages-test' })
    .setIssuer('https://pages-test.cloudflareaccess.com').setAudience('pages-app').setSubject('student-id')
    .setIssuedAt().setExpirationTime('7d').sign(pair.privateKey);
});
beforeEach(() => {
  vi.resetModules();
  vi.setSystemTime(baseTime);
  values = new Map();
  cache = {
    get: vi.fn(async (key: string) => values.has(key) ? JSON.parse(values.get(key)!) : null),
    put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
  };
  env = { FLIGHTLOGGER_API_TOKEN: 'test-token', AVAILABILITY_CACHE: cache as unknown as KVNamespace,
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
afterAll(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function request(path = '/api/availability?from=2026-09-01&to=2026-10-31', authenticated = true, method = 'GET') {
  const { onRequest: middleware } = await import('../functions/api/_middleware');
  const { onRequest: availability } = await import('../functions/api/availability');
  const { onRequest: me } = await import('../functions/api/me');
  const { onRequest: unknown } = await import('../functions/api/[[path]]');
  const req = new Request(`https://student.luftfartsfag.no${path}`, { method,
    headers: authenticated ? { 'Cf-Access-Jwt-Assertion': token } : {} });
  const data = {};
  const handler = path.startsWith('/api/availability') ? availability : path === '/api/me' ? me : unknown;
  const context = { request: req, env, data, next: () => handler(context as never) };
  return middleware(context as never);
}

describe('Pages Functions API with Access middleware', () => {
  it('requires Access even without Origin and before reading any cache', async () => {
    const response = await request(undefined, false);
    expect(response.status).toBe(401);
    expect(cache.get).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
    await request(); // warm cache
    expect((await request(undefined, false)).status).toBe(401);
  });

  it('fails closed when Access or FlightLogger configuration is absent', async () => {
    env.CF_ACCESS_AUD = '';
    expect((await request()).status).toBe(503);
    expect(cache.get).not.toHaveBeenCalled();
    env.CF_ACCESS_AUD = 'pages-app';
    env.FLIGHTLOGGER_API_TOKEN = '';
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

  it('returns only verified identity from /api/me', async () => {
    expect(await (await request('/api/me')).json()).toEqual({ email: 'student@example.test', subject: 'student-id' });
    expect((await request('/api/me', false)).status).toBe(401);
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
