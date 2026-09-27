import { ApplicationError } from './application-error';
import { requirePermission } from './authorization';
import { requireSameOrigin } from './same-origin';
import type { ApplicationUser } from './users';
import { isPermissionKey, isRoleKey, permissionDefinitions, PERMISSIONS,
  type AccessUpdate, type OverrideEffect, type PermissionKey, type RoleKey, type UserAccess } from '../shared/authorization';

const roleSql = 'SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.key';
const permissionSql = 'SELECT permission_key FROM effective_user_permissions WHERE user_id = ? ORDER BY permission_key';

export async function getUserAccess(db: D1Database, userId: string): Promise<UserAccess> {
  // D1 batch gives all editor data and the revision from one transaction.
  const result = await db.batch([
    db.prepare('SELECT id, email FROM users WHERE id = ?').bind(userId),
    db.prepare(roleSql).bind(userId),
    db.prepare(permissionSql).bind(userId),
    db.prepare(`SELECT DISTINCT rp.permission_key FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = ? ORDER BY rp.permission_key`).bind(userId),
    db.prepare('SELECT permission_key, effect FROM user_permission_overrides WHERE user_id = ?').bind(userId),
    db.prepare('SELECT revision FROM authorization_state WHERE id = 1'),
  ]);
  const user = result[0].results[0] as UserAccess['user'] | undefined;
  if (!user) throw new ApplicationError('Portal user not found.', 404);
  const permissions = (index: number) => (result[index].results as { permission_key: string }[]).map(row => row.permission_key).filter(isPermissionKey);
  const overrides: UserAccess['overrides'] = {};
  for (const row of result[4].results as { permission_key: string; effect: OverrideEffect }[]) {
    if (isPermissionKey(row.permission_key)) overrides[row.permission_key] = row.effect;
  }
  return { user, roles: (result[1].results as { key: string }[]).map(row => row.key).filter(isRoleKey),
    permissions: permissions(2), inheritedPermissions: permissions(3), overrides,
    revision: (result[5].results[0] as { revision: number }).revision };
}

export async function listPortalUsers(db: D1Database) {
  // Explicit projections keep credentials, Access subjects and JWTs out of admin responses.
  const result = await db.batch([
    db.prepare('SELECT id, email FROM users ORDER BY email, id'),
    db.prepare('SELECT ur.user_id, r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id ORDER BY r.key'),
    db.prepare('SELECT user_id, permission_key FROM effective_user_permissions ORDER BY permission_key'),
  ]);
  return (result[0].results as UserAccess['user'][]).map(user => ({ ...user,
    roles: (result[1].results as { user_id: string; key: string }[]).filter(row => row.user_id === user.id).map(row => row.key).filter(isRoleKey),
    permissions: (result[2].results as { user_id: string; permission_key: string }[]).filter(row => row.user_id === user.id).map(row => row.permission_key).filter(isPermissionKey),
  }));
}

function invalid(): never { throw new ApplicationError('Submit known roles, permission overrides and the current access revision.', 400, 'INVALID_ACCESS'); }
export async function readAccessUpdate(request: Request): Promise<AccessUpdate> {
  requireSameOrigin(request);
  if (new URL(request.url).search) invalid();
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApplicationError('Submit access changes as JSON.', 415);
  }
  const limit = 8192;
  if (Number(request.headers.get('Content-Length')) > limit) throw new ApplicationError('Access request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new ApplicationError('Access request is too large.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); } catch { invalid(); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 3 ||
      !('roles' in body) || !Array.isArray(body.roles) || !body.roles.every(isRoleKey) || new Set(body.roles).size !== body.roles.length ||
      !('revision' in body) || !Number.isSafeInteger(body.revision) || (body.revision as number) < 0 ||
      !('overrides' in body) || !body.overrides || typeof body.overrides !== 'object' || Array.isArray(body.overrides) ||
      !Object.entries(body.overrides).every(([key, value]) => isPermissionKey(key) && (value === 'ALLOW' || value === 'DENY'))) invalid();
  return body as AccessUpdate;
}

export async function updateUserAccess(db: D1Database, actor: ApplicationUser, targetId: string, update: AccessUpdate): Promise<UserAccess> {
  await requirePermission(db, actor, PERMISSIONS.adminManageUsers);
  const previous = await getUserAccess(db, targetId);
  if (previous.revision !== update.revision) throw new ApplicationError('Access changed. Reload access before saving.', 409, 'ACCESS_CONFLICT');
  const added = update.roles.filter(role => !previous.roles.includes(role));
  const removed = previous.roles.filter(role => !update.roles.includes(role));
  const changed = permissionDefinitions.filter(({ key }) => previous.overrides[key] !== update.overrides[key]);
  const privileged = added.includes('ADMIN') || removed.includes('ADMIN') || changed.some(permission => permission.privileged);
  if (privileged) await requirePermission(db, actor, PERMISSIONS.adminManagePermissions);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    // Recheck actor rights inside the write transaction to defeat concurrent revocation.
    db.prepare(`UPDATE authorization_state SET revision = CASE WHEN revision = ? AND
      EXISTS (SELECT 1 FROM effective_user_permissions WHERE user_id = ? AND permission_key = 'admin.manage_users') AND
      (? = 0 OR EXISTS (SELECT 1 FROM effective_user_permissions WHERE user_id = ? AND permission_key = 'admin.manage_permissions'))
      THEN revision + 1 ELSE -1 END WHERE id = 1`).bind(update.revision, actor.id, privileged ? 1 : 0, actor.id),
  ];
  function audit(action: string, permission: PermissionKey | null, role: RoleKey | null, oldValue: string | null, newValue: string | null) {
    statements.push(db.prepare(`INSERT INTO authorization_audit_log
      (id, actor_user_id, target_user_id, action, permission_key, role_key, previous_value, new_value, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), actor.id, targetId, action, permission, role, oldValue, newValue, now));
  }
  for (const role of added) {
    statements.push(db.prepare(`INSERT INTO user_roles (user_id, role_id, created_at, assigned_by_user_id)
      SELECT ?, id, ?, ? FROM roles WHERE key = ? AND is_system = 1`).bind(targetId, now, actor.id, role));
    audit('ROLE_ADDED', null, role, null, 'assigned');
  }
  for (const role of removed) {
    statements.push(db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = (SELECT id FROM roles WHERE key = ?)').bind(targetId, role));
    audit('ROLE_REMOVED', null, role, 'assigned', null);
  }
  for (const { key } of changed) {
    const effect = update.overrides[key];
    if (effect) {
      statements.push(db.prepare(`INSERT INTO user_permission_overrides
        (user_id, permission_key, effect, created_at, updated_at, changed_by_user_id) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, permission_key) DO UPDATE SET effect = excluded.effect, updated_at = excluded.updated_at,
          changed_by_user_id = excluded.changed_by_user_id`).bind(targetId, key, effect, now, now, actor.id));
      audit('OVERRIDE_SET', key, null, previous.overrides[key] || null, effect);
    } else {
      statements.push(db.prepare('DELETE FROM user_permission_overrides WHERE user_id = ? AND permission_key = ?').bind(targetId, key));
      audit('OVERRIDE_REMOVED', key, null, previous.overrides[key] || null, null);
    }
  }
  // Keep both an ADMIN assignment (bootstrap/recovery) and an effective administrator.
  // All preceding changes and audits roll back if either invariant would be lost.
  statements.push(db.prepare(`UPDATE authorization_state SET revision = CASE WHEN
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'ADMIN') AND
    EXISTS (SELECT 1 FROM effective_user_permissions a JOIN effective_user_permissions b ON b.user_id = a.user_id
      WHERE a.permission_key = 'admin.manage_users' AND b.permission_key = 'admin.manage_permissions')
    THEN revision ELSE -1 END WHERE id = 1`));
  try { await db.batch(statements); }
  catch (cause) {
    // Never return raw SQL/parameters. Only recognize our own named constraint.
    if (cause instanceof Error && cause.message.includes('authorization_guard')) {
      throw new ApplicationError('Access changed or this update would remove the final administrator. Reload access and try again.', 409, 'ACCESS_CONFLICT');
    }
    throw cause;
  }
  return getUserAccess(db, targetId);
}
