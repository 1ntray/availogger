import { ApplicationError } from './application-error';
import type { ApplicationUser } from './users';
import { isPermissionKey, isRoleKey, type PermissionKey, type RoleKey } from '../shared/authorization';

export async function getEffectivePermissions(db: D1Database, user: Pick<ApplicationUser, 'id'>): Promise<PermissionKey[]> {
  const rows = await db.prepare('SELECT permission_key FROM effective_user_permissions WHERE user_id = ? ORDER BY permission_key')
    .bind(user.id).all<{ permission_key: string }>();
  return rows.results.map(row => row.permission_key).filter(isPermissionKey);
}
export async function getUserRoles(db: D1Database, user: Pick<ApplicationUser, 'id'>): Promise<RoleKey[]> {
  const rows = await db.prepare('SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.key')
    .bind(user.id).all<{ key: string }>();
  return rows.results.map(row => row.key).filter(isRoleKey);
}
export async function hasPermission(db: D1Database, user: Pick<ApplicationUser, 'id'>, permission: PermissionKey): Promise<boolean> {
  if (!isPermissionKey(permission)) return false;
  return !!await db.prepare('SELECT 1 FROM effective_user_permissions WHERE user_id = ? AND permission_key = ?')
    .bind(user.id, permission).first();
}
export async function requirePermission(db: D1Database, user: Pick<ApplicationUser, 'id'>, permission: PermissionKey): Promise<void> {
  if (!await hasPermission(db, user, permission)) throw new ApplicationError('You do not have access to this feature.', 403, 'FORBIDDEN');
}

export async function bootstrapAdministrator(db: D1Database, user: ApplicationUser, bootstrapSubject: string | undefined): Promise<void> {
  // Exact comparison against the server-verified subject, never email or input.
  if (!bootstrapSubject || user.access_subject !== bootstrapSubject) return;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO user_roles (user_id, role_id, created_at, assigned_by_user_id)
      SELECT ?, id, ?, ? FROM roles WHERE key = 'ADMIN' AND NOT EXISTS
        (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'ADMIN')`)
      .bind(user.id, now, user.id),
    db.prepare(`INSERT INTO authorization_audit_log (id, actor_user_id, target_user_id, action, role_key, new_value, created_at)
      SELECT ?, ?, ?, 'ROLE_ADDED', 'ADMIN', 'assigned', ? WHERE changes() > 0`)
      .bind(crypto.randomUUID(), user.id, user.id, now),
    db.prepare('UPDATE authorization_state SET revision = revision + CASE WHEN changes() > 0 THEN 1 ELSE 0 END WHERE id = 1'),
  ]);
}
