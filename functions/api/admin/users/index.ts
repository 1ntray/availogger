import { methodNotAllowed, withAuthorizedUser } from '../../../../backend/application-api';
import { listPortalUsers } from '../../../../backend/admin-authorization';
import type { PagesEnv, AccessData } from '../../../../backend/env';
import { json } from '../../../../backend/response';
import { PERMISSIONS } from '../../../../shared/authorization';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  return withAuthorizedUser(context, PERMISSIONS.adminManageUsers, async db => json({ users: await listPortalUsers(db) }));
};
