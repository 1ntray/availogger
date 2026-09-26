import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptCredential, decryptCredential, validateEncryptionSecret, type EncryptedCredential } from '../backend/credential-encryption';
import { resolveApplicationUser } from '../backend/users';
import { getFlightLoggerCredential, hasFlightLoggerCredential, storeFlightLoggerCredential } from '../backend/flightlogger-credentials';
import { createTestDatabase, testEncryptionKey } from './d1-fixture';

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
const identity = { subject: 'verified-access-subject', email: 'student@example.test' };
beforeAll(async () => { fixture = await createTestDatabase(); }, 30_000);
beforeEach(async () => { await fixture.db.prepare('DELETE FROM users').run(); });
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await fixture?.dispose(); });

describe('D1 application users', () => {
  it('creates one user and reuses it across requests', async () => {
    const first = await resolveApplicationUser(fixture.db, identity);
    const second = await resolveApplicationUser(fixture.db, identity);
    expect(first.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(second).toEqual(first);
    expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM users').first('count')).toBe(1);
  });
  it('uses subject identity, never merging equal email addresses', async () => {
    const first = await resolveApplicationUser(fixture.db, identity);
    const second = await resolveApplicationUser(fixture.db, { ...identity, subject: 'different-subject' });
    expect(second.id).not.toBe(first.id);
    expect(second.email).toBe(first.email);
  });
  it('updates the verified email while preserving identity and creation time', async () => {
    const first = await resolveApplicationUser(fixture.db, identity);
    const updated = await resolveApplicationUser(fixture.db, { ...identity, email: 'new@example.test' });
    expect(updated).toMatchObject({ id: first.id, access_subject: identity.subject, email: 'new@example.test', created_at: first.created_at });
  });
  it('handles concurrent first requests without duplicate users', async () => {
    const users = await Promise.all(Array.from({ length: 4 }, () => resolveApplicationUser(fixture.db, identity)));
    expect(new Set(users.map(user => user.id)).size).toBe(1);
  });
  it('parameterizes identity strings instead of interpreting them as SQL', async () => {
    const original = await resolveApplicationUser(fixture.db, identity);
    const other = await resolveApplicationUser(fixture.db, { subject: "' OR 1=1 --", email: "'; DROP TABLE users; --" });
    expect(other.id).not.toBe(original.id);
    expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM users').first('count')).toBe(2);
  });
});

describe('AES-256-GCM credential encryption', () => {
  it('accepts exactly 32 canonical Base64 bytes', () => expect(validateEncryptionSecret(testEncryptionKey)).toHaveLength(32));
  it.each([undefined, '', 'plaintext', testEncryptionKey.slice(0,-1), btoa('short'), btoa('x'.repeat(31)), btoa('x'.repeat(33)), `${testEncryptionKey}\n`])('rejects invalid keys without echoing them', value => {
    expect(() => validateEncryptionSecret(value)).toThrow('encryption is not configured');
  });
  it('round-trips using fresh IVs and ciphertext without plaintext', async () => {
    const first = await encryptCredential('sensitive-test-token', 'user-1', testEncryptionKey);
    const second = await encryptCredential('sensitive-test-token', 'user-1', testEncryptionKey);
    expect(first.encryption_version).toBe(1);
    expect(atob(first.token_iv)).toHaveLength(12);
    expect(first.token_iv).not.toBe(second.token_iv);
    expect(first.token_ciphertext).not.toBe(second.token_ciphertext);
    expect(JSON.stringify(first)).not.toContain('sensitive-test-token');
    expect(await decryptCredential(first, 'user-1', testEncryptionKey)).toBe('sensitive-test-token');
  });
  it('authenticates user, key, IV, ciphertext and encryption version', async () => {
    const encrypted = await encryptCredential('secret-token', 'user-1', testEncryptionKey);
    await expect(decryptCredential(encrypted, 'user-2', testEncryptionKey)).rejects.toThrow('could not be read');
    await expect(decryptCredential(encrypted, 'user-1', btoa('x'.repeat(32)))).rejects.toThrow('could not be read');
    const tampered = { ...encrypted, token_ciphertext: `${encrypted.token_ciphertext[0] === 'A' ? 'B' : 'A'}${encrypted.token_ciphertext.slice(1)}` };
    await expect(decryptCredential(tampered, 'user-1', testEncryptionKey)).rejects.toThrow('could not be read');
    await expect(decryptCredential({ ...encrypted, token_iv: 'invalid' }, 'user-1', testEncryptionKey)).rejects.toThrow('could not be read');
    await expect(decryptCredential({ ...encrypted, encryption_version: 2 }, 'user-1', testEncryptionKey)).rejects.toThrow('could not be read');
    await expect(decryptCredential(encrypted, 'user-1', undefined)).rejects.toThrow('encryption is not configured');
  });
});

describe('validated credential storage and replacement', () => {
  function valid(id = 'flightlogger-user') {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ data: { user: { id } } }));
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  }
  it('validates the token with the smallest authenticated read-only query and stores ciphertext', async () => {
    const user = await resolveApplicationUser(fixture.db, identity);
    const fetcher = valid();
    expect(await storeFlightLoggerCredential(fixture.db, user, 'personal-test-key', testEncryptionKey)).toEqual({ connected: true, flightLoggerUserId: 'flightlogger-user' });
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: 'Bearer personal-test-key' });
    expect(JSON.parse(String(init.body))).toEqual({ query: 'query CurrentUser { user { id } }', variables: {} });
    const stored = await fixture.db.prepare('SELECT * FROM flightlogger_credentials WHERE user_id = ?').bind(user.id).first<EncryptedCredential>();
    expect(JSON.stringify(stored)).not.toContain('personal-test-key');
    expect(await getFlightLoggerCredential(fixture.db, user.id, testEncryptionKey)).toBe('personal-test-key');
    expect(await hasFlightLoggerCredential(fixture.db, user.id)).toBe(true);
    expect((await resolveApplicationUser(fixture.db, identity)).flightlogger_user_id).toBe('flightlogger-user');
  });
  it('never stores invalid keys or overwrites a valid credential on failed verification', async () => {
    const user = await resolveApplicationUser(fixture.db, identity);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(storeFlightLoggerCredential(fixture.db, user, 'bad-key', testEncryptionKey)).rejects.toMatchObject({ status: 422 });
    expect(await hasFlightLoggerCredential(fixture.db, user.id)).toBe(false);
    valid('first-fl-user');
    await storeFlightLoggerCredential(fixture.db, user, 'good-key', testEncryptionKey);
    const original = await fixture.db.prepare('SELECT * FROM flightlogger_credentials').first();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    await expect(storeFlightLoggerCredential(fixture.db, user, 'bad-replacement', testEncryptionKey)).rejects.toMatchObject({ status: 422 });
    expect(await fixture.db.prepare('SELECT * FROM flightlogger_credentials').first()).toEqual(original);
    expect((await resolveApplicationUser(fixture.db, identity)).flightlogger_user_id).toBe('first-fl-user');
  });
  it('replaces successfully with a new IV and updated FlightLogger user', async () => {
    const user = await resolveApplicationUser(fixture.db, identity);
    valid('first'); await storeFlightLoggerCredential(fixture.db, user, 'same-key', testEncryptionKey);
    const original = await fixture.db.prepare('SELECT * FROM flightlogger_credentials').first<EncryptedCredential & { created_at: string }>();
    valid('second'); await storeFlightLoggerCredential(fixture.db, user, 'same-key', testEncryptionKey);
    const updated = await fixture.db.prepare('SELECT * FROM flightlogger_credentials').first<EncryptedCredential & { created_at: string }>();
    expect(updated!.token_iv).not.toBe(original!.token_iv);
    expect(updated!.token_ciphertext).not.toBe(original!.token_ciphertext);
    expect(updated!.created_at).toBe(original!.created_at);
    expect((await resolveApplicationUser(fixture.db, identity)).flightlogger_user_id).toBe('second');
  });
  it('rolls back the FlightLogger user ID if the credential write fails', async () => {
    const user = await resolveApplicationUser(fixture.db, identity);
    valid('original'); await storeFlightLoggerCredential(fixture.db, user, 'original-key', testEncryptionKey);
    await fixture.db.prepare("CREATE TRIGGER reject_replacement BEFORE UPDATE ON flightlogger_credentials BEGIN SELECT RAISE(ABORT, 'test rollback'); END").run();
    try {
      valid('new-user');
      await expect(storeFlightLoggerCredential(fixture.db, user, 'new-key', testEncryptionKey)).rejects.toThrow();
      expect((await resolveApplicationUser(fixture.db, identity)).flightlogger_user_id).toBe('original');
      expect(await getFlightLoggerCredential(fixture.db, user.id, testEncryptionKey)).toBe('original-key');
    } finally { await fixture.db.prepare('DROP TRIGGER reject_replacement').run(); }
  });
  it('does not call FlightLogger or store credentials when encryption is missing', async () => {
    const user = await resolveApplicationUser(fixture.db, identity);
    const fetcher = valid();
    await expect(storeFlightLoggerCredential(fixture.db, user, 'test-key', undefined)).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await hasFlightLoggerCredential(fixture.db, user.id)).toBe(false);
    await expect(getFlightLoggerCredential(fixture.db, user.id, testEncryptionKey)).rejects.toMatchObject({ status: 409, code: 'ONBOARDING_REQUIRED' });
  });
  it.each([422, 429, 503])('does not store credentials on validation failure (%s)', async status => {
    const user = await resolveApplicationUser(fixture.db, identity);
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.stubGlobal('fetch', vi.fn(async () => status === 422 ? Response.json({ data: { user: null } })
        : new Response('upstream submitted-secret-key', { status, headers: { 'Retry-After': '30' } })));
      await expect(storeFlightLoggerCredential(fixture.db, user, `bad-key-${status}`, testEncryptionKey)).rejects.toMatchObject({ status });
      expect(await hasFlightLoggerCredential(fixture.db, user.id)).toBe(false);
      expect((await resolveApplicationUser(fixture.db, identity)).flightlogger_user_id).toBeNull();
    } finally { logger.mockRestore(); }
  });
});
