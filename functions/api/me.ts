import type { AccessData, PagesEnv } from '../../backend/env';
import { json } from '../../backend/response';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => {
  if (context.request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  return context.data.accessIdentity
    ? json(context.data.accessIdentity)
    : json({ error: 'Cloudflare Access authentication is required.' }, 401);
};
