import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { encryptCredential } from '../backend/credential-encryption';
import { resolveApplicationUser } from '../backend/users';

// Public deterministic key for tests only. Never a local/production secret.
export const testEncryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));

export async function createTestDatabase(initializeAuthorization = true) {
  const runtime = new Miniflare(convertV4MiniflareOptions({
    telemetry: { enabled: false },
    modules: true, script: 'export default { fetch() { return new Response("test"); } }',
    compatibilityDate: '2026-09-01', d1Databases: { DB: 'unit-test-database' }, d1Persist: false,
  }));
  const db = await runtime.getD1Database('DB') as unknown as D1Database;
  const directory = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(file => file.endsWith('.sql')).sort()) {
    if (!initializeAuthorization && file >= '0003') continue;
    const schema = readFileSync(new URL(file, directory), 'utf8');
    // Trigger bodies contain semicolons; preserve the explicit SQL boundaries.
    const statements = schema.includes('-- statement-breakpoint')
      ? schema.split('-- statement-breakpoint') : schema.replace(/^--.*$/gm, '').split(';');
    await db.batch(statements.map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
  }
  return { db, dispose: () => runtime.dispose() };
}

export async function applyAuthorizationMigration(db: D1Database) {
  const authorization = readFileSync(new URL('../migrations/0003_authorization.sql', import.meta.url), 'utf8');
  await db.batch(authorization.split('-- statement-breakpoint').map(sql => db.prepare(sql.trim())));
}

export async function grantAvailability(db: D1Database, userId: string) {
  await db.prepare(`INSERT INTO user_permission_overrides (user_id, permission_key, effect, created_at, updated_at)
    VALUES (?, 'availability.view', 'ALLOW', 'test', 'test')`).bind(userId).run();
}

export async function seedCredential(db: D1Database, subject = 'student-id', token = 'test-token', email = 'student@example.test', id = 'fl-student') {
  const user = await resolveApplicationUser(db, { subject, email });
  const encrypted = await encryptCredential(token, user.id, testEncryptionKey);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare('UPDATE users SET flightlogger_user_id = ? WHERE id = ?').bind(id, user.id),
    db.prepare('INSERT INTO flightlogger_credentials VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, encrypted.token_ciphertext, encrypted.token_iv, encrypted.encryption_version, now, now),
  ]);
  return { ...user, flightlogger_user_id: id };
}
