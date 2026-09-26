import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { getAccessIdentity, verifyAccessToken } from '../backend/access';

const issuer = 'https://test-team.cloudflareaccess.com';
const audience = 'test-application';
const instant = new Date('2026-09-26T12:00:00Z');
const seconds = instant.getTime() / 1000;
let privateKey: CryptoKey;
let keys: JWTVerifyGetKey;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(instant);
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'test', alg: 'RS256' }] });
});
afterAll(() => vi.useRealTimers());

function token(claims: Record<string, unknown> = {}) {
  return new SignJWT({ type: 'app', email: 'student@example.test', sub: 'user-123',
    iss: issuer, aud: audience, iat: seconds, exp: seconds + 600, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(privateKey);
}

describe('verified Access identity', () => {
  it('returns only the verified user email and subject', async () => {
    expect(await verifyAccessToken(await token(), issuer, audience, keys)).toEqual({ email: 'student@example.test', subject: 'user-123' });
  });

  it.each([
    { aud: 'another-app' }, { iss: 'https://another-team.cloudflareaccess.com' },
    { exp: seconds - 60 }, { nbf: seconds + 100 }, { iat: seconds + 100 },
    { email: undefined }, { sub: '' }, { exp: undefined }, { type: 'service' },
  ])('rejects incorrect or missing claims: %j', async claims => {
    await expect(verifyAccessToken(await token(claims), issuer, audience, keys)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a forged signature and unsupported algorithm', async () => {
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({ email: 'student@example.test' }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(other.privateKey);
    await expect(verifyAccessToken(forged, issuer, audience, keys)).rejects.toMatchObject({ status: 401 });
    const hs = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).sign(new Uint8Array(32));
    await expect(verifyAccessToken(hs, issuer, audience, keys)).rejects.toMatchObject({ status: 401 });
  });

  it('fails closed on key-service errors without exposing internals', async () => {
    const unavailable: JWTVerifyGetKey = async () => { throw new TypeError('internal network detail'); };
    await expect(verifyAccessToken(await token(), issuer, audience, unavailable)).rejects.toMatchObject({ status: 503 });
  });

  it('requires configuration and ignores unverified identity headers', async () => {
    const request = new Request('https://student.luftfartsfag.no/api/me', { headers: { 'Cf-Access-Authenticated-User-Email': 'forged@example.test' } });
    await expect(getAccessIdentity(request, {})).rejects.toMatchObject({ status: 503 });
    await expect(getAccessIdentity(request, { CF_ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com', CF_ACCESS_AUD: audience })).rejects.toMatchObject({ status: 401 });
    await expect(getAccessIdentity(request, { CF_ACCESS_TEAM_DOMAIN: 'http://localhost:9999', CF_ACCESS_AUD: audience })).rejects.toMatchObject({ status: 503 });
  });

  it('permits only explicit loopback development, never public hosts', async () => {
    expect(await getAccessIdentity(new Request('http://localhost:8788/api/me'), { LOCAL_ACCESS_DEV: 'true' })).toEqual({ email: 'local@localhost', subject: 'local-development' });
    await expect(getAccessIdentity(new Request('http://localhost:8788/api/me'), {})).rejects.toMatchObject({ status: 503 });
    const env = { LOCAL_ACCESS_DEV: 'true', CF_ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com', CF_ACCESS_AUD: audience };
    for (const host of ['student.luftfartsfag.no', 'availogger.pages.dev', 'preview.availogger.pages.dev']) {
      await expect(getAccessIdentity(new Request(`https://${host}/api/me`, { headers: { Host: 'localhost' } }), env)).rejects.toMatchObject({ status: 401 });
    }
  });
});
