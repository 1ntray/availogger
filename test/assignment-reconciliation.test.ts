import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyTestMigration, createTestDatabase, seedCredential } from './d1-fixture';
import { readAssignmentStates } from '../backend/assignment-reconciliation';
import { readOwned } from '../backend/exchange-v2/assignments';
import { createExchange as createDutyExchange } from '../backend/duty-ops/swaps';
import { createExchange as createFlyvaskExchange } from '../backend/flyvask/swaps';
import type { ApplicationUser } from '../backend/users';

const now = '2026-10-04T08:00:00.000Z';
const starts = '2026-10-10T08:00:00.000Z', ends = '2026-10-10T12:00:00.000Z';
type Domain = 'DUTY_OPS' | 'FLYVASK';
let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
const users = {} as Record<'A'|'B'|'C'|'D'|'E'|'F', ApplicationUser>;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now));
  fixture = await createTestDatabase();
  for (const name of ['A','B','C','D','E','F'] as const) {
    users[name] = await seedCredential(fixture.db,`reconcile-${name}`,`${name}-token`,`${name}@test`,`fl-${name}`);
    await fixture.db.prepare('UPDATE users SET flightlogger_first_name=? WHERE id=?').bind(name,users[name].id).run();
    for(const permission of ['duty_ops.swap','flyvask.swap']) await fixture.db.prepare(`INSERT INTO user_permission_overrides
      (user_id,permission_key,effect,created_at,updated_at) VALUES (?,?,'ALLOW',?,?)`).bind(users[name].id,permission,now,now).run();
  }
});
afterAll(async () => { vi.useRealTimers(); await fixture.dispose(); });
const prefix = (domain: Domain) => domain === 'DUTY_OPS' ? 'duty_ops' : 'flyvask';
async function shift(domain: Domain, count: number, names: (keyof typeof users)[]) {
  const id=crypto.randomUUID(), p=prefix(domain);
  await fixture.db.prepare(`INSERT INTO ${p}_shifts
    (id,flightlogger_booking_id,starts_at,ends_at,status,participant_count,last_synced_at)
    VALUES (?,?,?,?,'OPEN',?,?)`).bind(id,`fl-${id}`,starts,ends,count,now).run();
  await raw(domain,id,names);
  return id;
}
async function raw(domain:Domain,id:string,names:(keyof typeof users)[]) {
  const p=prefix(domain);
  await fixture.db.prepare(`DELETE FROM ${p}_assignments WHERE shift_id=?`).bind(id).run();
  for(const name of names)await fixture.db.prepare(`INSERT INTO ${p}_assignments VALUES (?,?,?)`).bind(id,users[name].id,now).run();
}
async function accept(domain:Domain,id:string,source:keyof typeof users,receiver:keyof typeof users) {
  const p=prefix(domain),requestId=crypto.randomUUID();
  if(domain==='DUTY_OPS'){
    await fixture.db.prepare(`INSERT INTO duty_ops_swap_requests
      (id,requester_user_id,requested_shift_id,requested_starts_at,requested_ends_at,type,status,
       accepted_by_user_id,created_at,updated_at,accepted_at)
      VALUES (?,?,?,?,?,'GIVE_AWAY','ACCEPTED',?,?,?,?)`)
      .bind(requestId,users[source].id,id,starts,ends,users[receiver].id,now,now,now).run();
  } else {
    const offered=await shift(domain,1,[receiver]);
    await fixture.db.prepare(`INSERT INTO flyvask_swap_requests
      (id,requester_user_id,requested_shift_id,requested_starts_at,requested_ends_at,status,created_at,updated_at)
      VALUES (?,?,?,?,?,'OPEN',?,?)`).bind(requestId,users[source].id,id,starts,ends,now,now).run();
    const proposalId=crypto.randomUUID();
    await fixture.db.prepare(`INSERT INTO flyvask_swap_proposals
      (id,request_id,proposer_user_id,offered_shift_id,offered_starts_at,offered_ends_at,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'ACCEPTED',?,?)`).bind(proposalId,requestId,users[receiver].id,offered,starts,ends,now,now).run();
    await fixture.db.prepare(`UPDATE flyvask_swap_requests SET status='ACCEPTED',accepted_by_user_id=?,accepted_proposal_id=?,accepted_at=? WHERE id=?`)
      .bind(users[receiver].id,proposalId,now,requestId).run();
  }
  return requestId;
}
async function acceptV2(domain:Domain,id:string,source:keyof typeof users,receiver:keyof typeof users) {
  const intent=crypto.randomUUID(),candidate=crypto.randomUUID();
  await fixture.db.prepare(`INSERT INTO exchange_v2_intents
    (id,domain,owner_user_id,source_assignment_id,source_snapshot,source_version,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'v1','COMPLETED',?,?)`)
    .bind(intent,domain,users[source].id,id,'{}',now,now).run();
  await fixture.db.prepare(`INSERT INTO exchange_v2_candidates
    (id,domain,intent_id,status,created_at,updated_at) VALUES (?,?,?,'WAITING',?,?)`)
    .bind(candidate,domain,intent,now,now).run();
  await fixture.db.batch([
    fixture.db.prepare(`INSERT INTO exchange_v2_assignment_effects VALUES (?,?,?,?,0,?)`).bind(candidate,domain,id,users[source].id,now),
    fixture.db.prepare(`INSERT INTO exchange_v2_assignment_effects VALUES (?,?,?,?,1,?)`).bind(candidate,domain,id,users[receiver].id,now),
    fixture.db.prepare(`UPDATE exchange_v2_candidates SET status='COMPLETED',completed_at=? WHERE id=?`).bind(now,candidate),
  ]);
  return candidate;
}
async function state(domain:Domain,id:string,viewer:keyof typeof users='B') {
  const read=await readAssignmentStates(fixture.db,domain,[id],users[viewer].id);
  return read(id,(await fixture.db.prepare(`SELECT participant_count FROM ${prefix(domain)}_shifts WHERE id=?`).bind(id).first<number>('participant_count'))!);
}
const names=(value:Awaited<ReturnType<typeof state>>) => value.participants.map(p=>p.firstName).sort();

describe.each(['DUTY_OPS','FLYVASK'] as Domain[])('%s assignment reconciliation', domain => {
  it('keeps the global count and marks stale no-exchange identity overcount without an audit event', async () => {
    const id=await shift(domain,3,['A','C','D','E']);
    const eventTable=domain==='DUTY_OPS'?'duty_ops_swap_events':'flyvask_swap_events';
    const eventsBefore=await fixture.db.prepare(`SELECT count(*) n FROM ${eventTable}`).first<number>('n');
    const value=await state(domain,id);
    expect(value.participantCount).toBe(3);
    expect(value.participants).toHaveLength(0);
    expect(value.assignmentsDiffer).toBe(false);
    expect(value.participantIntegrity).toEqual({status:'CONFLICT',reason:'RAW_IDENTITY_OVERCOUNT'});
    expect(await fixture.db.prepare(`SELECT count(*) n FROM ${eventTable}`).first<number>('n')).toBe(eventsBefore);
  });
  it('replaces one slot, converges once, and preserves the portal owner on source divergence', async () => {
    const id=await shift(domain,3,['A','D','E']);
    const request=await accept(domain,id,'A','B');
    let value=await state(domain,id);
    expect(names(value)).toEqual(['B','D','E']);
    expect(value.participantIntegrity.status).toBe('CONSISTENT');
    expect(value.assignmentsDiffer).toBe(true);
    await raw(domain,id,['B','D','E']);
    value=await state(domain,id);
    expect(names(value)).toEqual(['B','D','E']);
    expect(value.participantIntegrity.status).toBe('CONSISTENT');
    expect(value.assignmentsDiffer).toBe(false);
    await raw(domain,id,['C','D','E']);
    value=await state(domain,id);
    expect(value.participantCount).toBe(3);
    expect(names(value)).toEqual(['B']);
    expect(value.isCurrentUserAssigned).toBe(true);
    expect(value.participantIntegrity).toEqual({status:'CONFLICT',reason:'PORTAL_SOURCE_DIVERGED'});
    expect((await fixture.db.prepare(`SELECT user_id FROM ${prefix(domain)}_effective_assignments WHERE shift_id=?`)
      .bind(id).all<{user_id:string}>()).results.map(row=>row.user_id)).toEqual([users.B.id]);
    await expect(readOwned(fixture.db,domain,id,users.B.id)).rejects.toMatchObject({status:409,code:'EXCHANGE_ASSIGNMENT_SYNC_CONFLICT'});
    await expect(domain==='DUTY_OPS'
      ? createDutyExchange(fixture.db,users.B,id,'DIRECT_SWAP',{startsAt:starts,endsAt:ends})
      : createFlyvaskExchange(fixture.db,users.B,id,{startsAt:starts,endsAt:ends}))
      .rejects.toMatchObject({status:409});
    expect(await fixture.db.prepare(`SELECT status FROM ${prefix(domain)}_swap_requests WHERE id=?`).bind(request).first<string>('status')).toBe('ACCEPTED');
    await raw(domain,id,['A','C','D','E']);
    value=await state(domain,id);
    expect(names(value)).toEqual(['B']);
    expect(value.participantCount).toBe(3);
    expect(value.participantIntegrity).toEqual({status:'CONFLICT',reason:'RAW_IDENTITY_OVERCOUNT'});
    expect((await fixture.db.prepare(`SELECT user_id FROM ${prefix(domain)}_effective_assignments WHERE shift_id=?`)
      .bind(id).all<{user_id:string}>()).results.map(row=>row.user_id)).toEqual([users.B.id]);
    expect((await fixture.db.prepare(`SELECT count(*) n FROM ${prefix(domain)}_assignments WHERE shift_id=?`).bind(id).first<number>('n'))).toBe(4);
    await raw(domain,id,['B','D','E']);
    value=await state(domain,id);
    expect(names(value)).toEqual(['B','D','E']);
    expect(value.participantIntegrity.status).toBe('CONSISTENT');
    await expect(readOwned(fixture.db,domain,id,users.B.id)).resolves.toMatchObject({userId:users.B.id});
    await expect(domain==='DUTY_OPS'
      ? createDutyExchange(fixture.db,users.B,id,'DIRECT_SWAP',{startsAt:starts,endsAt:ends})
      : createFlyvaskExchange(fixture.db,users.B,id,{startsAt:starts,endsAt:ends}))
      .resolves.toHaveProperty('id');
  });
  it('keeps a partial self-sync separate from a conflict', async () => {
    const id=await shift(domain,3,['A','D']);
    const value=await state(domain,id);
    expect(names(value)).toEqual(['A','D']);
    expect(value.participantIntegrity).toEqual({status:'PARTIAL',reason:'IDENTITIES_INCOMPLETE'});
  });
  it('does not allocate two portal slots from one original identity', async () => {
    const id=await shift(domain,2,['A','D']);
    await accept(domain,id,'A','B'); await accept(domain,id,'A','C');
    const value=await state(domain,id);
    expect(value.participantCount).toBe(2);
    expect(value.participantIntegrity).toEqual({status:'CONFLICT',reason:'PORTAL_LINEAGE_UNVERIFIED'});
    expect(value.participants).toHaveLength(0);
  });
  it('keeps independent transferred slots separate and deduplicates accounts for one FlightLogger identity', async () => {
    const id=await shift(domain,3,['A','D','E']);
    await accept(domain,id,'A','B'); await acceptV2(domain,id,'D','F');
    const alias=await seedCredential(fixture.db,`alias-${domain}-${id}`,'token',`alias-${id}@test`,'fl-E');
    await fixture.db.prepare(`INSERT INTO ${prefix(domain)}_assignments VALUES (?,?,?)`).bind(id,alias.id,now).run();
    const value=await state(domain,id);
    expect(names(value)).toEqual(['B','E','F']);
    expect(value.participantCount).toBe(3);
    expect(value.participantIntegrity.status).toBe('CONSISTENT');
    expect(value.assignmentsDiffer).toBe(true);
  });
  it('follows a transfer chain through original, intermediate and converged source states', async () => {
    const id=await shift(domain,1,['A']);
    await accept(domain,id,'A','B'); await accept(domain,id,'B','C');
    for(const source of ['A','B','C'] as const){
      await raw(domain,id,[source]);
      const value=await state(domain,id,'C');
      expect(names(value)).toEqual(['C']);
      expect(value.participantIntegrity.status).toBe('CONSISTENT');
    }
    await raw(domain,id,['D']);
    const value=await state(domain,id,'C');
    expect(names(value)).toEqual(['C']);
    expect(value.participantIntegrity.reason).toBe('PORTAL_SOURCE_DIVERGED');
  });
  it('preserves a v2 receiver when FlightLogger later diverges', async () => {
    const id=await shift(domain,1,['A']);
    await acceptV2(domain,id,'A','B');
    await raw(domain,id,['C']);
    const value=await state(domain,id);
    expect(names(value)).toEqual(['B']);
    expect(value.participantCount).toBe(1);
    expect(value.participantIntegrity).toEqual({status:'CONFLICT',reason:'PORTAL_SOURCE_DIVERGED'});
    expect((await fixture.db.prepare(`SELECT user_id FROM ${prefix(domain)}_effective_assignments WHERE shift_id=?`)
      .bind(id).all<{user_id:string}>()).results.map(row=>row.user_id)).toEqual([users.B.id]);
    await expect(readOwned(fixture.db,domain,id,users.B.id)).rejects.toMatchObject({
      status:409,code:'EXCHANGE_ASSIGNMENT_SYNC_CONFLICT',
    });
  });
});

it('marks equal-time linked historical backfill as unverified instead of inventing transfer order', async () => {
  const legacy=await createTestDatabase(true,'0015_schedule_notifications.sql');
  try {
    const a=await seedCredential(legacy.db,'legacy-a','token','a@legacy','legacy-a');
    const b=await seedCredential(legacy.db,'legacy-b','token','b@legacy','legacy-b');
    const c=await seedCredential(legacy.db,'legacy-c','token','c@legacy','legacy-c');
    const id=crypto.randomUUID();
    await legacy.db.prepare(`INSERT INTO duty_ops_shifts VALUES (?, ?, ?, ?, 'OPEN', 1, NULL, ?)`)
      .bind(id,`fl-${id}`,starts,ends,now).run();
    await legacy.db.prepare('INSERT INTO duty_ops_assignments VALUES (?,?,?)').bind(id,a.id,now).run();
    for(const [giver,receiver] of [[a,b],[b,c]]) await legacy.db.prepare(`INSERT INTO duty_ops_swap_requests
      (id,requester_user_id,requested_shift_id,requested_starts_at,requested_ends_at,type,status,
       accepted_by_user_id,created_at,updated_at,accepted_at)
      VALUES (?,?,?,?,?,'GIVE_AWAY','ACCEPTED',?,?,?,?)`)
      .bind(crypto.randomUUID(),giver.id,id,starts,ends,receiver.id,now,now,now).run();
    await applyTestMigration(legacy.db,'0016_assignment_reconciliation.sql');
    const read=await readAssignmentStates(legacy.db,'DUTY_OPS',[id],c.id);
    expect(read(id,1).participantIntegrity).toEqual({status:'CONFLICT',reason:'PORTAL_LINEAGE_UNVERIFIED'});
    expect(read(id,1).participants).toHaveLength(0);
    expect((await legacy.db.prepare('SELECT DISTINCT provenance FROM assignment_transfers').all<{provenance:string}>()).results)
      .toEqual([{provenance:'BACKFILLED'}]);
  } finally {await legacy.dispose();}
},40000);
