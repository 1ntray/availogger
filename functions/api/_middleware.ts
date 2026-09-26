import { AccessError, getAccessIdentity } from '../../backend/access';
import type { PagesEnv, AccessData } from '../../backend/env';
import { json } from '../../backend/response';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = async context => {
  try {
    context.data.accessIdentity = await getAccessIdentity(context.request, context.env);
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.message }, error.status);
    return json({ error: 'Cloudflare Access could not be verified. Try again shortly.' }, 503);
  }
  return context.next();
};
