import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapAdministrator, getEffectivePermissions, getUserRoles, hasPermission } from '../backend/authorization';
import { getUserAccess, updateUserAccess } from '../backend/admin-authorization';
import { resolveApplicationUser, type ApplicationUser } from '../backend/users';
import { applyAuthorizationMigration, createTestDatabase, testEncryptionKey } from './d1-fixture';
import { onRequest as accessEndpoint } from '../functions/api/admin/users/[id]/access';
import { onRequest as listEndpoint } from '../functions/api/admin/users/index';
import { onRequest as catalogueEndpoint } from '../functions/api/admin/permissions';
import { onRequest as availabilityEndpoint } from '../functions/api/availability';
import { onRequest as meEndpoint } from '../functions/api/me';
import { permissionDefinitions, type AccessUpdate } from '../shared/authorization';

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let admin: ApplicationUser;
let student: ApplicationUser;
beforeAll(async () => { fixture = await createTestDatabase(); });
beforeEach(async () => {
  await fixture.db.prepare('DELETE FROM users').run();
  await fixture.db.prepare('DELETE FROM authorization_audit_log').run();
  admin = await resolveApplicationUser(fixture.db, { subject: 'verified-owner', email: 'owner@example.test' });
  student = await resolveApplicationUser(fixture.db, { subject: 'verified-student', email: 'student@example.test' });
});
afterAll(async () => { await fixture?.dispose(); });
async function owner() { await bootstrapAdministrator(fixture.db, admin, admin.access_subject); }
async function update(user: ApplicationUser, changes: Partial<AccessUpdate>) {
  const previous = await getUserAccess(fixture.db, user.id);
  return { roles: previous.roles, overrides: previous.overrides, revision: previous.revision, ...changes };
}
async function endpoint(handler: unknown, actor = admin, target = student.id, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const path = handler === listEndpoint ? '/api/admin/users' : handler === catalogueEndpoint ? '/api/admin/permissions'
    : handler === meEndpoint ? '/api/me' : handler === availabilityEndpoint ? '/api/availability' : `/api/admin/users/${target}/access`;
  const request = new Request(`https://portal.example.test${path}`, { method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return (handler as typeof accessEndpoint)({ request, params: { id: target },
    env: { DB: fixture.db, FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY: testEncryptionKey },
    data: { accessIdentity: { subject: actor.access_subject, email: actor.email } } } as never);
}

describe('roles and effective permissions', () => {
  it('assigns STUDENT once on account creation with only baseline permissions', async () => {
    expect(await getUserRoles(fixture.db, student)).toEqual(['STUDENT']);
    expect(await getEffectivePermissions(fixture.db, student)).toEqual(['brakkevakt.swap', 'brakkevakt.view', 'duty_ops.view', 'flights.view', 'flyvask.swap', 'flyvask.view', 'fuel.request', 'transport.book_university_cars', 'transport.view']);
    expect(await hasPermission(fixture.db, student, 'availability.view')).toBe(false);
    expect(await hasPermission(fixture.db, student, 'future.view' as never)).toBe(false);
    await fixture.db.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(student.id).run();
    await resolveApplicationUser(fixture.db, { subject: student.access_subject, email: student.email });
    expect(await getUserRoles(fixture.db, student)).toEqual([]);
  });
  it('backfills existing application users without changing their identities or credentials', async () => {
    const old = await createTestDatabase(false);
    try {
      const user = await resolveApplicationUser(old.db, { subject: 'existing-subject', email: 'existing@example.test' });
      await applyAuthorizationMigration(old.db);
      expect(await getUserRoles(old.db, user)).toEqual(['STUDENT']);
      expect(await old.db.prepare('SELECT id FROM users').first('id')).toBe(user.id);
    } finally { await old.dispose(); }
  });
  it('ADMIN receives every defined permission, with explicit DENY taking precedence', async () => {
    await owner();
    expect(new Set(await getEffectivePermissions(fixture.db, admin))).toEqual(new Set(permissionDefinitions.map(permission => permission.key)));
    await updateUserAccess(fixture.db, admin, admin.id, await update(admin, { overrides: { 'availability.view': 'DENY' } }));
    expect(await hasPermission(fixture.db, admin, 'availability.view')).toBe(false);
  });
  it('explicit ALLOW grants missing access and removing the override restores role default', async () => {
    await owner();
    await updateUserAccess(fixture.db, admin, student.id, await update(student, { overrides: { 'availability.view': 'ALLOW', 'transport.view': 'DENY' } }));
    expect(await getEffectivePermissions(fixture.db, student)).toEqual(['availability.view', 'brakkevakt.swap', 'brakkevakt.view', 'duty_ops.view', 'flights.view', 'flyvask.swap', 'flyvask.view', 'fuel.request', 'transport.book_university_cars']);
    await updateUserAccess(fixture.db, admin, student.id, await update(student, { overrides: {} }));
    expect(await getEffectivePermissions(fixture.db, student)).toEqual(['brakkevakt.swap', 'brakkevakt.view', 'duty_ops.view', 'flights.view', 'flyvask.swap', 'flyvask.view', 'fuel.request', 'transport.book_university_cars', 'transport.view']);
  });
  it('newly catalogued permissions stay denied until explicitly granted', async () => {
    await fixture.db.prepare("INSERT INTO permissions VALUES ('future.view', 'Future feature')").run();
    try {
      expect(await fixture.db.prepare("SELECT 1 FROM effective_user_permissions WHERE user_id = ? AND permission_key = 'future.view'").bind(student.id).first()).toBeNull();
    } finally { await fixture.db.prepare("DELETE FROM permissions WHERE key = 'future.view'").run(); }
  });
});

describe('first administrator bootstrap', () => {
  it('matches the verified subject exactly, never email, and never returns its secret', async () => {
    await bootstrapAdministrator(fixture.db, admin, undefined);
    await bootstrapAdministrator(fixture.db, admin, admin.email);
    await bootstrapAdministrator(fixture.db, admin, `${admin.access_subject} `);
    await bootstrapAdministrator(fixture.db, student, admin.access_subject);
    expect(await getUserRoles(fixture.db, admin)).toEqual(['STUDENT']);
    await owner();
    expect(await getUserRoles(fixture.db, admin)).toEqual(['ADMIN', 'STUDENT']);
    expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM authorization_audit_log').first('count')).toBe(1);
  });
  it('does nothing when an ADMIN assignment exists, including concurrent first requests', async () => {
    await Promise.all([owner(), owner(), owner()]);
    await bootstrapAdministrator(fixture.db, student, student.access_subject);
    expect(await getUserRoles(fixture.db, student)).toEqual(['STUDENT']);
    expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM authorization_audit_log').first('count')).toBe(1);
  });
});

describe('admin API security and audit transactions', () => {
  it('forbids ordinary students from every admin endpoint and returns 401 without identity', async () => {
    for (const handler of [listEndpoint, catalogueEndpoint, accessEndpoint]) {
      expect((await endpoint(handler, student)).status).toBe(403);
    }
    expect((await accessEndpoint({ request: new Request('https://portal.test/api/admin/users/id/access'), env: {}, data: {} } as never)).status).toBe(401);
  });
  it('allows an admin to edit ordinary permissions and records add/change/remove audits', async () => {
    await owner();
    const initial = await update(student, { overrides: { 'availability.view': 'ALLOW' } });
    expect((await endpoint(accessEndpoint, admin, student.id, 'PUT', initial)).status).toBe(200);
    await updateUserAccess(fixture.db, admin, student.id, await update(student, { overrides: { 'availability.view': 'DENY' } }));
    await updateUserAccess(fixture.db, admin, student.id, await update(student, { overrides: {} }));
    const rows = await fixture.db.prepare('SELECT actor_user_id, action, previous_value, new_value FROM authorization_audit_log WHERE target_user_id = ? ORDER BY rowid').bind(student.id).all();
    expect(rows.results).toEqual([
      { actor_user_id: admin.id, action: 'OVERRIDE_SET', previous_value: null, new_value: 'ALLOW' },
      { actor_user_id: admin.id, action: 'OVERRIDE_SET', previous_value: 'ALLOW', new_value: 'DENY' },
      { actor_user_id: admin.id, action: 'OVERRIDE_REMOVED', previous_value: 'DENY', new_value: null },
    ]);
  });
  it('manage_users alone cannot escalate through roles, admin overrides, or management capabilities', async () => {
    await owner();
    await updateUserAccess(fixture.db, admin, student.id, await update(student, { overrides: { 'admin.manage_users': 'ALLOW' } }));
    expect((await endpoint(accessEndpoint, student, student.id, 'PUT', await update(student,
      { overrides: { 'admin.manage_users': 'ALLOW', 'availability.view': 'ALLOW' } }))).status).toBe(200);
    expect((await endpoint(accessEndpoint, student, student.id, 'PUT', await update(student, { roles: ['ADMIN', 'STUDENT'] }))).status).toBe(403);
    expect((await endpoint(accessEndpoint, student, student.id, 'PUT', await update(student,
      { overrides: { 'admin.manage_users': 'ALLOW', 'admin.manage_permissions': 'ALLOW' } }))).status).toBe(403);
    expect(await getUserRoles(fixture.db, student)).toEqual(['STUDENT']);
  });
  it.each(['admin.manage_users', 'admin.manage_permissions', 'duty_ops.manage_schedule', 'transport.manage_university_cars'])('manage_users alone cannot modify privileged capability %s', async key => {
    await owner();
    await updateUserAccess(fixture.db, admin, student.id, await update(student, { overrides: { 'admin.manage_users': 'ALLOW' } }));
    expect((await endpoint(accessEndpoint, student, admin.id, 'PUT', await update(admin, { overrides: { [key]: 'DENY' } }))).status).toBe(403);
  });
  it('rejects final ADMIN removal and denies of either admin permission, rolling back all edits and audit rows', async () => {
    await owner();
    const original = await getUserAccess(fixture.db, admin.id);
    for (const changes of [{ roles: ['STUDENT'] as ['STUDENT'] }, { overrides: { 'admin.manage_users': 'DENY' as const } },
      { overrides: { 'admin.manage_permissions': 'DENY' as const, 'availability.view': 'DENY' as const } }]) {
      const response = await endpoint(accessEndpoint, admin, admin.id, 'PUT', await update(admin, changes));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'ACCESS_CONFLICT' });
      expect(await getUserAccess(fixture.db, admin.id)).toEqual(original);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM authorization_audit_log').first('count')).toBe(1);
    }
  });
  it('allows removal when another effective ADMIN remains and audits role changes', async () => {
    await owner();
    await updateUserAccess(fixture.db, admin, student.id, await update(student, { roles: ['ADMIN', 'STUDENT'] }));
    const result = await updateUserAccess(fixture.db, admin, admin.id, await update(admin, { roles: ['STUDENT'] }));
    expect(result.roles).toEqual(['STUDENT']);
    expect(await hasPermission(fixture.db, student, 'admin.manage_permissions')).toBe(true);
    const audit = await fixture.db.prepare("SELECT action, role_key, previous_value, new_value FROM authorization_audit_log WHERE action = 'ROLE_REMOVED'").first();
    expect(audit).toEqual({ action: 'ROLE_REMOVED', role_key: 'ADMIN', previous_value: 'assigned', new_value: null });
  });
  it('does not count an ADMIN whose effective administrative permission is denied', async () => {
    await owner();
    await updateUserAccess(fixture.db, admin, student.id, await update(student, { roles: ['ADMIN', 'STUDENT'], overrides: { 'admin.manage_permissions': 'DENY' } }));
    expect((await endpoint(accessEndpoint, admin, admin.id, 'PUT', await update(admin, { roles: ['STUDENT'] }))).status).toBe(409);
  });
  it('rejects stale editors and serializes simultaneous demotions so an effective admin remains', async () => {
    await owner();
    await updateUserAccess(fixture.db, admin, student.id, await update(student, { roles: ['ADMIN', 'STUDENT'] }));
    const [first, second] = await Promise.all([update(admin, { roles: ['STUDENT'] }), update(student, { roles: ['STUDENT'] })]);
    const results = await Promise.allSettled([
      updateUserAccess(fixture.db, admin, admin.id, first), updateUserAccess(fixture.db, student, student.id, second),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect([await hasPermission(fixture.db, admin, 'admin.manage_permissions'), await hasPermission(fixture.db, student, 'admin.manage_permissions')].filter(Boolean)).toHaveLength(1);
  });
  it.each([
    { roles: ['SUPERADMIN'], overrides: {}, revision: 0 },
    { roles: ['STUDENT'], overrides: { 'unknown.view': 'ALLOW' }, revision: 0 },
    { roles: ['STUDENT'], overrides: { 'availability.view': 'yes' }, revision: 0 },
    { roles: ['STUDENT', 'STUDENT'], overrides: {}, revision: 0 },
    { roles: ['STUDENT'], overrides: {}, revision: -1 },
    { roles: ['STUDENT'], overrides: {}, revision: 0, subject: 'forged' },
    { roles: ['STUDENT'], overrides: {} },
    null,
  ])('rejects invalid, unknown or identity-selecting updates %#', async body => {
    await owner();
    expect((await endpoint(accessEndpoint, admin, student.id, 'PUT', body)).status).toBe(400);
  });
  it('rejects cross-site writes and disallows GET mutation bodies and missing users', async () => {
    await owner();
    const body = await update(student, { overrides: { 'availability.view': 'ALLOW' } });
    for (const headers of [{ Origin: 'https://attacker.test' }, { 'Sec-Fetch-Site': 'cross-site' }] as Record<string, string>[]) {
      expect((await endpoint(accessEndpoint, admin, student.id, 'PUT', body, headers)).status).toBe(403);
    }
    expect((await endpoint(accessEndpoint, admin, student.id, 'POST', body)).status).toBe(405);
    expect((await endpoint(accessEndpoint, admin, 'missing')).status).toBe(404);
    expect(await hasPermission(fixture.db, student, 'availability.view')).toBe(false);
  });
  it('returns only safe catalogue/user/access metadata, and /api/me keeps onboarding independent', async () => {
    await owner();
    for (const handler of [listEndpoint, catalogueEndpoint, accessEndpoint, meEndpoint]) {
      const response = await endpoint(handler);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toMatch(/ciphertext|token_iv|encryption_version|BOOTSTRAP|audit_log|role_id|verified-student/);
      if (handler !== meEndpoint) expect(text).not.toContain('verified-owner');
    }
    const me = await (await endpoint(meEndpoint, student)).json();
    expect(me).toMatchObject({ onboardingComplete: false, hasFlightLoggerCredential: false,
      roles: ['STUDENT'], permissions: ['brakkevakt.swap', 'brakkevakt.view', 'duty_ops.view', 'flights.view', 'flyvask.swap', 'flyvask.view', 'fuel.request', 'transport.book_university_cars', 'transport.view'] });
    expect((await endpoint(availabilityEndpoint, student)).status).toBe(403);
    await updateUserAccess(fixture.db, admin, student.id, await update(student, { overrides: { 'availability.view': 'ALLOW' } }));
    expect((await endpoint(availabilityEndpoint, student)).status).toBe(409); // Authorized, now needs onboarding.
  });
});
