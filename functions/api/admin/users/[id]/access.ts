import { methodNotAllowed, withAuthorizedUser } from '../../../../../backend/application-api';
import { getUserAccess, readAccessUpdate, updateUserAccess } from '../../../../../backend/admin-authorization';
import type { PagesEnv, AccessData } from '../../../../../backend/env';
import { json } from '../../../../../backend/response';
import { PERMISSIONS } from '../../../../../shared/authorization';

export const onRequest: PagesFunction<PagesEnv, 'id', AccessData> = context => {
  if (!['GET', 'PUT'].includes(context.request.method)) return methodNotAllowed('GET, PUT');
  return withAuthorizedUser(context, PERMISSIONS.adminManageUsers, async (db, user) => {
    const id = context.params.id;
    if (typeof id !== 'string' || !id || id.length > 128) return json({ error: 'Portal user not found.' }, 404);
    if (context.request.method === 'GET') return json(await getUserAccess(db, id));
    const update = await readAccessUpdate(context.request);
    return json(await updateUserAccess(db, user, id, update));
  });
};
