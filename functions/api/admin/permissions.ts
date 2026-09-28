import { methodNotAllowed, withAuthorizedUser } from '../../../backend/application-api';
import type { PagesEnv, AccessData } from '../../../backend/env';
import { json } from '../../../backend/response';
import { permissionDefinitions, PERMISSIONS, isPermissionKey } from '../../../shared/authorization';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  return withAuthorizedUser(context, PERMISSIONS.adminManageUsers, async db => {
    const roles = await db.prepare('SELECT key, name FROM roles WHERE is_system = 1 ORDER BY key').all();
    const grants = await db.prepare('SELECT r.key AS role, rp.permission_key FROM roles r JOIN role_permissions rp ON rp.role_id = r.id').all();
    return json({ permissions: permissionDefinitions, roles: roles.results.map(role => ({ ...role,
      permissions: grants.results.filter(grant => grant.role === role.key).map(grant => grant.permission_key).filter(isPermissionKey),
    })) });
  });
};
