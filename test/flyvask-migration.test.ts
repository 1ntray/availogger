import { readFileSync, existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createTestDatabase, seedCredential } from './d1-fixture';
import { createExchange, createProposal, acceptProposal } from '../backend/duty-ops/swaps';
import { listSwapHistory } from '../backend/duty-ops/swap-history';

it('adds Flyvask to a populated 0006 database without disturbing Duty Ops agreements or raw snapshots', async()=>{
  const old=await createTestDatabase(true,'0006_duty_ops_effective_assignments.sql');
  try {
    const alice=await seedCredential(old.db,'migration-alice','test-alice','alice@test','fl-alice');
    const bob=await seedCredential(old.db,'migration-bob','test-bob','bob@test','fl-bob');
    const start=new Date(Date.now()+86400000).toISOString(),end=new Date(Date.now()+90000000).toISOString();
    const a=crypto.randomUUID(),b=crypto.randomUUID(),stamp=new Date().toISOString();
    for(const [id,user] of [[a,alice],[b,bob]] as const) await old.db.batch([
      old.db.prepare('INSERT INTO duty_ops_shifts VALUES (?, ?, ?, ?, ?, 2, NULL, ?)').bind(id,`fl-${id}`,start,end,'OPEN',stamp),
      old.db.prepare('INSERT INTO duty_ops_assignments VALUES (?, ?, ?)').bind(id,user.id,stamp),
      old.db.prepare("INSERT INTO user_permission_overrides VALUES (?, 'duty_ops.swap', 'ALLOW', ?, ?, NULL)").bind(user.id,stamp,stamp),
    ]);
    const r=await createExchange(old.db,alice,a,'DIRECT_SWAP',{startsAt:start,endsAt:end});
    const p=await createProposal(old.db,bob,r.id,b,{startsAt:start,endsAt:end});await acceptProposal(old.db,alice,r.id,p.id);
    const raw=(await old.db.prepare('SELECT * FROM duty_ops_assignments').all()).results;
    const effective=(await old.db.prepare('SELECT * FROM duty_ops_effective_assignments').all()).results;
    const migration=readFileSync(new URL('../migrations/0007_flyvask.sql',import.meta.url),'utf8');expect(migration).not.toContain('\r');
    await old.db.batch(migration.split('-- statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(s=>old.db.prepare(s)));
    expect((await old.db.prepare('SELECT * FROM duty_ops_assignments').all()).results).toEqual(raw);
    expect((await old.db.prepare('SELECT * FROM duty_ops_effective_assignments').all()).results).toEqual(effective);
    expect((await listSwapHistory(old.db,alice,null)).entries).toHaveLength(1);
    expect(await old.db.prepare("SELECT COUNT(*) n FROM effective_user_permissions WHERE user_id=? AND permission_key LIKE 'flyvask.%'").bind(alice.id).first('n')).toBe(2);
    // There is no Function that could dispatch a one-way transfer.
    expect(existsSync(new URL('../functions/api/flyvask/swaps/[requestId]/claim.ts',import.meta.url))).toBe(false);
  } finally {await old.dispose();}
});
