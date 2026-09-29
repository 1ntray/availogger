import { afterEach, expect, test } from 'vitest';
import { applyTestMigration, createTestDatabase, seedCredential } from './d1-fixture';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

test('migration 0012 preserves v1 effective views and grants audit only to administrators', async () => {
  const { db, dispose } = await createTestDatabase();
  cleanups.push(dispose);
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'exchange_v2_%'").all<{name:string}>();
  expect(tables.results.map(row => row.name)).toContain('exchange_v2_candidates');
  await expect(db.prepare('SELECT * FROM duty_ops_effective_assignments').all()).resolves.toBeDefined();
  await expect(db.prepare('SELECT * FROM flyvask_effective_assignments').all()).resolves.toBeDefined();
  const grants = await db.prepare("SELECT r.key FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE rp.permission_key='admin.exchange_audit'").all<{key:string}>();
  expect(grants.results.map(row => row.key)).toEqual(['ADMIN']);
}, 30_000);

test('migration 0012 retains populated accepted v1 effects and an open v1 request',async()=>{
  const {db,dispose}=await createTestDatabase(true,'0011_flight_changes.sql');cleanups.push(dispose);
  const alice=await seedCredential(db,'legacy-a','a','a@test','legacy-a');
  const bob=await seedCredential(db,'legacy-b','b','b@test','legacy-b');
  const first=crypto.randomUUID(),second=crypto.randomUUID(),accepted=crypto.randomUUID(),open=crypto.randomUUID();
  const start='2026-10-05T06:00:00.000Z',end='2026-10-05T11:00:00.000Z',stamp='2026-09-28T08:00:00.000Z';
  await db.batch([
    ...[first,second].map(id=>db.prepare("INSERT INTO duty_ops_shifts VALUES (?,?,?,?,'OPEN',1,NULL,?)")
      .bind(id,`fl-${id}`,start,end,stamp)),
    db.prepare('INSERT INTO duty_ops_assignments VALUES (?,?,?)').bind(first,alice.id,stamp),
    db.prepare('INSERT INTO duty_ops_assignments VALUES (?,?,?)').bind(second,alice.id,stamp),
    db.prepare(`INSERT INTO duty_ops_swap_requests
      (id,requester_user_id,requested_shift_id,requested_starts_at,requested_ends_at,type,status,
       accepted_by_user_id,created_at,updated_at,accepted_at)
      VALUES (?,?,?,?,?,'GIVE_AWAY','ACCEPTED',?,?,?,?)`)
      .bind(accepted,alice.id,first,start,end,bob.id,stamp,stamp,stamp),
    db.prepare(`INSERT INTO duty_ops_swap_requests
      (id,requester_user_id,requested_shift_id,requested_starts_at,requested_ends_at,type,status,created_at,updated_at)
      VALUES (?,?,?,?,?,'DIRECT_SWAP','OPEN',?,?)`).bind(open,alice.id,second,start,end,stamp,stamp),
  ]);
  await applyTestMigration(db,'0012_exchange_v2.sql');
  expect((await db.prepare('SELECT user_id FROM duty_ops_effective_assignments WHERE shift_id=?')
    .bind(first).first<string>('user_id'))).toBe(bob.id);
  expect((await db.prepare('SELECT status FROM duty_ops_swap_requests WHERE id=?')
    .bind(open).first<string>('status'))).toBe('OPEN');
},45_000);
