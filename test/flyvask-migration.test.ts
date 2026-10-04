import { readFileSync, existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createTestDatabase, seedCredential } from './d1-fixture';
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
    // Seed the old accepted shape directly: the current mutation service requires
    // the reconciliation view added in 0016, which this upgrade fixture lacks.
    const requestId=crypto.randomUUID(),proposalId=crypto.randomUUID();
    await old.db.batch([
      old.db.prepare(`INSERT INTO duty_ops_swap_requests
        (id,requester_user_id,requested_shift_id,requested_starts_at,requested_ends_at,type,status,created_at,updated_at)
        VALUES (?,?,?,?,?,'DIRECT_SWAP','OPEN',?,?)`)
        .bind(requestId,alice.id,a,start,end,stamp,stamp),
      old.db.prepare(`INSERT INTO duty_ops_swap_proposals
        (id,request_id,proposer_user_id,offered_shift_id,offered_starts_at,offered_ends_at,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'ACCEPTED',?,?)`)
        .bind(proposalId,requestId,bob.id,b,start,end,stamp,stamp),
      old.db.prepare(`UPDATE duty_ops_swap_requests SET status='ACCEPTED',accepted_by_user_id=?,
        accepted_proposal_id=?,accepted_at=? WHERE id=?`).bind(bob.id,proposalId,stamp,requestId),
    ]);
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
}, 20000);
