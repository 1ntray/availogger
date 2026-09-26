import { ApplicationError } from './application-error';
import { validateEncryptionSecret } from './credential-encryption';
import type { AccessData, PagesEnv } from './env';
import { json } from './response';
import { resolveApplicationUser, type ApplicationUser } from './users';

type ApplicationContext = { request: Request; env: PagesEnv; data: AccessData };

export async function withApplicationUser(context: ApplicationContext, work: (db: D1Database, user: ApplicationUser) => Promise<Response>): Promise<Response> {
  if (!context.data.accessIdentity) return json({ error: 'Cloudflare Access authentication is required.' }, 401);
  try {
    if (!context.env.DB) throw new ApplicationError('The student portal database is not configured.', 503);
    validateEncryptionSecret(context.env.FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY);
    const user = await resolveApplicationUser(context.env.DB, context.data.accessIdentity);
    return await work(context.env.DB, user);
  } catch (cause) {
    if (cause instanceof ApplicationError) {
      const response = json({ error: cause.message, ...(cause.code ? { code: cause.code } : {}) }, cause.status);
      if (cause.retryAfterSeconds) response.headers.set('Retry-After', String(cause.retryAfterSeconds));
      return response;
    }
    // D1/crypto exceptions may contain SQL parameters or credential material.
    // Do not log the exception or pass its message to the client.
    return json({ error: 'The student portal data service is unavailable. Try again shortly.', code: 'PORTAL_UNAVAILABLE' }, 503);
  }
}

export function methodNotAllowed(allowed: string): Response {
  const response = json({ error: 'Method not allowed.' }, 405);
  response.headers.set('Allow', allowed);
  return response;
}
