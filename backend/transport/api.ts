import { withAuthorizedUser, methodNotAllowed } from '../application-api';
import type { AccessData, PagesEnv } from '../env';
import type { ApplicationUser } from '../users';
import { json } from '../response';
import { PERMISSIONS } from '../../shared/authorization';
import { readTransportBody } from './request';

type Context = { request: Request; env: PagesEnv; data: AccessData; params: Record<string, string | string[]> };
type Action = (db: D1Database, user: ApplicationUser, body: Record<string, unknown>) => Promise<unknown>;
export function transportGet(context: Context, action: (db: D1Database, user: ApplicationUser, request: Request) => Promise<unknown>) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  return withAuthorizedUser(context, PERMISSIONS.transportView, async (db, user) => json(await action(db, user, context.request)));
}
export function transportPost(context: Context, required: string[], optional: string[], action: Action, status = 200) {
  if (context.request.method !== 'POST') return methodNotAllowed('POST');
  return withAuthorizedUser(context, PERMISSIONS.transportView, async (db, user) => {
    const body = await readTransportBody(context.request, required, optional);
    return json(await action(db, user, body), status);
  });
}
