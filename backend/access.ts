import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AccessEnv {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  LOCAL_ACCESS_DEV?: string;
}

export interface AccessIdentity {
  email: string;
  subject: string;
}

export class AccessError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function issuerFor(domain: string | undefined): string {
  const host = (domain || '').trim().replace(/^https:\/\//, '').replace(/\/$/, '');
  if (!/^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(host)) {
    throw new AccessError('Cloudflare Access is not configured.', 503);
  }
  return `https://${host}`;
}

export async function verifyAccessToken(token: string, issuer: string, audience: string, keys: JWTVerifyGetKey): Promise<AccessIdentity> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer, audience, algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'email'], clockTolerance: 5,
    });
    if (payload.type !== 'app' || typeof payload.email !== 'string' || !payload.email || payload.email.length > 254 ||
        typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 256 ||
        typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 5) {
      throw new AccessError('Cloudflare Access authentication is required.', 401);
    }
    return { email: payload.email, subject: payload.sub };
  } catch (error) {
    if (error instanceof AccessError) throw error;
    if (error instanceof errors.JOSEError && error.code !== 'ERR_JWKS_TIMEOUT' && error.code !== 'ERR_JOSE_GENERIC') {
      throw new AccessError('Cloudflare Access authentication is required.', 401);
    }
    throw new AccessError('Cloudflare Access could not be verified. Try again shortly.', 503);
  }
}

export async function getAccessIdentity(request: Request, env: AccessEnv): Promise<AccessIdentity> {
  const hostname = new URL(request.url).hostname;
  // Opt-in local development only. No unverified identity headers are ever used.
  // Even an accidental production binding cannot bypass Access on a public hostname.
  if (env.LOCAL_ACCESS_DEV === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    return { email: 'local@localhost', subject: 'local-development' };
  }
  const issuer = issuerFor(env.CF_ACCESS_TEAM_DOMAIN);
  const audience = env.CF_ACCESS_AUD?.trim();
  if (!audience) throw new AccessError('Cloudflare Access is not configured.', 503);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16_384) throw new AccessError('Cloudflare Access authentication is required.', 401);
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 });
    if (keySets.size >= 4) keySets.delete(keySets.keys().next().value!);
    keySets.set(issuer, keys);
  }
  return verifyAccessToken(token, issuer, audience, keys);
}
