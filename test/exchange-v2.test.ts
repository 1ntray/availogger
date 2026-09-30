import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, seedCredential } from './d1-fixture';
import type { ApplicationUser } from '../backend/users';
import { acceptTarget, claimGiveAway, commitCandidate, confirmCandidate, createIntent, createOffer,
  insertCandidate } from '../backend/exchange-v2/service';
import { listExchangeV2 } from '../backend/exchange-v2/read';
import { readMembers } from '../backend/exchange-v2/assignments';
import { listCredits } from '../backend/duty-ops/credits';
import { listInbox } from '../backend/inbox';
import { reconcileExchangeV2 } from '../backend/exchange-v2/reconciliation';
import { exchangeV2Endpoint } from '../backend/exchange-v2/api';
import { auditEndpoint } from '../backend/exchange-v2/audit';
import { testEncryptionKey } from './d1-fixture';

const now='2026-09-28T08:00:00.000Z';
const first='2026-10-05T06:00:00.000Z',second='2026-10-06T06:00:00.000Z',third='2026-10-07T06:00:00.000Z';
let fixture:Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(now));fixture=await createTestDatabase();});
afterAll(async()=>{vi.useRealTimers();await fixture.dispose();});
async function student(name:string){
  const user=await seedCredential(fixture.db,`${name}-${crypto.randomUUID()}`,`${name}-token`,`${name}@test`,
    `fl-${name}-${crypto.randomUUID()}`);
  await fixture.db.prepare('UPDATE users SET flightlogger_first_name=? WHERE id=?').bind(name,user.id).run();
  await fixture.db.prepare(`INSERT INTO user_permission_overrides
    (user_id,permission_key,effect,created_at,updated_at) VALUES (?,'duty_ops.swap','ALLOW',?,?)`)
    .bind(user.id,now,now).run();
  return user;
}
async function duty(owner:ApplicationUser,start=first){
  const id=crypto.randomUUID(),end=new Date(Date.parse(start)+5*3600_000).toISOString();
  await fixture.db.batch([
    fixture.db.prepare("INSERT INTO duty_ops_shifts VALUES (?,?,?,?,'OPEN',1,NULL,?)")
      .bind(id,`fl-${id}`,start,end,now),
    fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?,?,?)').bind(id,owner.id,now),
  ]);return id;
}
async function owner(id:string){return (await readMembers(fixture.db,'DUTY_OPS',id))[0]?.userId;}
async function grant(user:ApplicationUser,permission:string){
  await fixture.db.prepare(`INSERT INTO user_permission_overrides
    (user_id,permission_key,effect,created_at,updated_at) VALUES (?,?,'ALLOW',?,?)`)
    .bind(user.id,permission,now,now).run();
}
async function fly(owner:ApplicationUser,start=first){
  const id=crypto.randomUUID(),end=new Date(Date.parse(start)+3*3600_000).toISOString();
  await fixture.db.batch([
    fixture.db.prepare("INSERT INTO flyvask_shifts VALUES (?,?,?,?,'OPEN',1,NULL,NULL,NULL,?)")
      .bind(id,`fl-${id}`,start,end,now),
    fixture.db.prepare('INSERT INTO flyvask_assignments VALUES (?,?,?)').bind(id,owner.id,now),
  ]);return id;
}
async function brakkeWeek(firstOwner:ApplicationUser,secondOwner:ApplicationUser,week:string){
  const periodId=crypto.randomUUID(),firstId=crypto.randomUUID(),secondId=crypto.randomUUID();
  await fixture.db.batch([
    fixture.db.prepare('INSERT INTO brakkevakt_periods VALUES (?,?,0,0,?,?,?,?)')
      .bind(periodId,week,now,firstOwner.id,now,firstOwner.id),
    fixture.db.prepare('INSERT INTO brakkevakt_assignments VALUES (?,?,?,?,?,?,?,?)')
      .bind(firstId,periodId,1,firstOwner.id,now,firstOwner.id,now,firstOwner.id),
    fixture.db.prepare('INSERT INTO brakkevakt_assignments VALUES (?,?,?,?,?,?,?,?)')
      .bind(secondId,periodId,2,secondOwner.id,now,firstOwner.id,now,firstOwner.id),
    fixture.db.prepare('UPDATE brakkevakt_periods SET published=1,revision=1 WHERE id=?').bind(periodId),
  ]);
  return firstId;
}

describe('Exchange v2 guarded outcomes',()=>{
  it('derives ordinary target requests, valid sources and sent state on the server',async()=>{
    const requester=await student('requester'),owner=await student('ordinary-owner');
    const source=await duty(requester),target=await duty(owner,second);
    const before=await listExchangeV2(fixture.db,requester,'DUTY_OPS',[target]);
    const state=before.assignmentStates.find(item=>item.assignmentId===target)!;
    expect(state.availableActions).toContain('REQUEST_SWAP');
    expect(state.requestableSourceAssignmentIds).toContain(source);
    await createIntent(fixture.db,requester,'DUTY_OPS',source,[target],false);
    const after=(await listExchangeV2(fixture.db,requester,'DUTY_OPS',[target])).assignmentStates
      .find(item=>item.assignmentId===target)!;
    expect(after.relationship).toBe('REQUEST_SENT');
    expect(after.availableActions).not.toContain('REQUEST_SWAP');
    expect(after.relatedIntentIds).toHaveLength(1);
  },40_000);
  it('enforces the ten explicit target limit before writing an intent',async()=>{
    const actor=await student('limit-owner'),x=await duty(actor);
    await expect(createIntent(fixture.db,actor,'DUTY_OPS',x,
      Array.from({length:11},()=>crypto.randomUUID()),false)).rejects.toMatchObject({status:400});
    expect((await fixture.db.prepare('SELECT count(*) n FROM exchange_v2_intents WHERE owner_user_id=?')
      .bind(actor.id).first<{n:number}>())?.n).toBe(0);
  },40_000);
  it('commits a targeted request without asking the requester twice; other targets are superseded',async()=>{
    const a=await student('target-a'),b=await student('target-b'),c=await student('target-c');
    const x=await duty(a),y=await duty(b,second),z=await duty(c,third);
    const created=await createIntent(fixture.db,a,'DUTY_OPS',x,[y,z],false);
    expect((await listInbox(fixture.db,b.id,new URL('https://portal.test/api/inbox'))).items
      .some(item=>item.title==='Swap request')).toBe(true);
    const state=await listExchangeV2(fixture.db,b,'DUTY_OPS',[y]);
    const target=state.intents.find(i=>i.id===created.id)!.targets.find(t=>t.assignment.id===y)!;
    expect(state.assignmentStates.find(s=>s.assignmentId===y)?.availableActions).toContain('ACCEPT_TARGET');
    await acceptTarget(fixture.db,b,target.id);
    expect((await listInbox(fixture.db,a.id,new URL('https://portal.test/api/inbox'))).items
      .some(item=>item.title==='Exchange agreed')).toBe(true);
    expect((await fixture.db.prepare("SELECT count(*) n FROM user_inbox_items WHERE user_id=? AND source_type='EXCHANGE' AND source_id=? AND kind='INFO'")
      .bind(b.id,(await fixture.db.prepare('SELECT completed_candidate_id FROM exchange_v2_intents WHERE id=?').bind(created.id).first<string>('completed_candidate_id'))).first<number>('n'))).toBe(0);
    expect(await owner(x)).toBe(b.id);expect(await owner(y)).toBe(a.id);
    const statuses=(await fixture.db.prepare('SELECT status FROM exchange_v2_targets WHERE intent_id=? ORDER BY assignment_id')
      .bind(created.id).all<{status:string}>()).results.map(r=>r.status).sort();
    expect(statuses).toEqual(['COMPLETED','SUPERSEDED']);
    expect(await owner(z)).toBe(c.id);
    await expect(acceptTarget(fixture.db,c,state.intents.find(i=>i.id===created.id)!.targets.find(t=>t.assignment.id===z)!.id))
      .rejects.toMatchObject({status:409});
  },40_000);

  it('keeps an open offer tentative until requester consents, then changes both memberships atomically',async()=>{
    const a=await student('offer-a'),b=await student('offer-b');const x=await duty(a),y=await duty(b,second);
    const intent=await createIntent(fixture.db,a,'DUTY_OPS',x,[],false);
    const offered=await createOffer(fixture.db,b,intent.id,y);
    expect(offered.status).toBe('OPEN');expect(await owner(x)).toBe(a.id);
    expect((await listInbox(fixture.db,a.id,new URL('https://portal.test/api/inbox'))).items
      .some(item=>item.title==='Review exchange')).toBe(true);
    await confirmCandidate(fixture.db,a,offered.candidateId);
    expect((await listInbox(fixture.db,b.id,new URL('https://portal.test/api/inbox'))).items
      .some(item=>item.title==='Exchange agreed')).toBe(true);
    expect((await fixture.db.prepare("SELECT count(*) n FROM user_inbox_items WHERE user_id=? AND source_type='EXCHANGE' AND source_id=? AND kind='INFO'")
      .bind(a.id,offered.candidateId).first<number>('n'))).toBe(0);
    expect(await owner(x)).toBe(b.id);expect(await owner(y)).toBe(a.id);
    await expect(commitCandidate(fixture.db,a,offered.candidateId)).rejects.toMatchObject({status:409});
  },40_000);

  it('allows only one of two current target members to accept the same request',async()=>{
    const a=await student('target-race-a'),b=await student('target-race-b'),c=await student('target-race-c');
    const x=await duty(a),y=await duty(b,second);
    await fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?,?,?)').bind(y,c.id,now).run();
    const request=await createIntent(fixture.db,a,'DUTY_OPS',x,[y],false);
    const target=(await fixture.db.prepare('SELECT id FROM exchange_v2_targets WHERE intent_id=?')
      .bind(request.id).first<{id:string}>())!.id;
    const result=await Promise.allSettled([acceptTarget(fixture.db,b,target),acceptTarget(fixture.db,c,target)]);
    expect(result.filter(item=>item.status==='fulfilled')).toHaveLength(1);
    expect([b.id,c.id]).toContain(await owner(x));
    expect((await fixture.db.prepare('SELECT count(*) n FROM exchange_v2_candidates WHERE intent_id=? AND status=\'COMPLETED\'')
      .bind(request.id).first<{n:number}>())?.n).toBe(1);
  },40_000);

  it('allows one give-away winner and writes balanced immutable credit entries',async()=>{
    const a=await student('gift-a'),b=await student('gift-b'),c=await student('gift-c');const x=await duty(a);
    const intent=await createIntent(fixture.db,a,'DUTY_OPS',x,[],true);
    const races=await Promise.allSettled([claimGiveAway(fixture.db,b,intent.id),claimGiveAway(fixture.db,c,intent.id)]);
    expect(races.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const credits=(await fixture.db.prepare(`SELECT amount FROM exchange_v2_credit_entries WHERE candidate_id=
      (SELECT completed_candidate_id FROM exchange_v2_intents WHERE id=?)`).bind(intent.id).all<{amount:number}>()).results;
    expect(credits.map(r=>r.amount).sort()).toEqual([-1,1]);
    expect(credits.reduce((sum,r)=>sum+r.amount,0)).toBe(0);
    expect((await fixture.db.prepare('SELECT count(*) n FROM duty_ops_assignments WHERE shift_id=? AND user_id=?')
      .bind(x,a.id).first<{n:number}>())?.n).toBe(1);
    const winner=(await owner(x))===b.id?b:c;
    expect((await listInbox(fixture.db,a.id,new URL('https://portal.test/api/inbox'))).items
      .some(item=>item.title==='Exchange agreed')).toBe(true);
    expect((await fixture.db.prepare("SELECT count(*) n FROM user_inbox_items WHERE user_id=? AND source_type='EXCHANGE' AND kind='INFO' AND source_id=(SELECT completed_candidate_id FROM exchange_v2_intents WHERE id=?)")
      .bind(winner.id,intent.id).first<number>('n'))).toBe(0);
    const ownerHistory=await listCredits(fixture.db,a,null);
    const winnerHistory=await listCredits(fixture.db,winner,null);
    expect(ownerHistory.entries.find(entry=>entry.shift.id===x)).toMatchObject({
      amount:-1,counterparty:{id:winner.id},shift:{id:x},
    });
    expect(winnerHistory.entries.find(entry=>entry.shift.id===x)).toMatchObject({
      amount:1,counterparty:{id:a.id},shift:{id:x},
    });
  },40_000);

  it('generates a consented three-way cycle and commits all legs',async()=>{
    const a=await student('cycle-a'),b=await student('cycle-b'),c=await student('cycle-c');
    const x=await duty(a),y=await duty(b,second),z=await duty(c,third);
    await createIntent(fixture.db,a,'DUTY_OPS',x,[y],false);
    await createIntent(fixture.db,b,'DUTY_OPS',y,[z],false);
    const matched=await createIntent(fixture.db,c,'DUTY_OPS',z,[x],false);
    expect(matched.candidates.some(item=>item.status==='COMPLETED')).toBe(true);
    expect(await owner(x)).toBe(c.id);expect(await owner(y)).toBe(a.id);expect(await owner(z)).toBe(b.id);
    const entries=await fixture.db.prepare(`SELECT count(*) n FROM exchange_v2_credit_entries c JOIN exchange_v2_candidates x
      ON x.id=c.candidate_id WHERE x.intent_id=?`).bind(matched.id).first<{n:number}>();
    expect(entries?.n).toBe(0);
  },40_000);

  it('commits a three-person give-away chain with net credit deltas -1, 0, +1',async()=>{
    const a=await student('chain-a'),middle=await student('chain-middle'),recipient=await student('chain-recipient');
    const x=await duty(a),y=await duty(middle,second);
    const gift=await createIntent(fixture.db,a,'DUTY_OPS',x,[],true);
    const exchange=await createIntent(fixture.db,middle,'DUTY_OPS',y,[x],false);
    const xMember=(await readMembers(fixture.db,'DUTY_OPS',x))[0];
    const yMember=(await readMembers(fixture.db,'DUTY_OPS',y))[0];
    const candidateId=crypto.randomUUID();
    await fixture.db.batch(insertCandidate(fixture.db,candidateId,'DUTY_OPS',gift.id,null,null,[
      {member:xMember,receive:null,userId:a.id,consent:'GIVE_AWAY'},
      {member:yMember,receive:xMember,userId:middle.id,consent:'TARGET'},
      {member:null,receive:yMember,userId:recipient.id,consent:null},
    ],now,[exchange.id]));
    await confirmCandidate(fixture.db,recipient,candidateId);
    expect(await owner(x)).toBe(middle.id);expect(await owner(y)).toBe(recipient.id);
    const deltas=(await fixture.db.prepare('SELECT amount FROM exchange_v2_credit_entries WHERE candidate_id=? ORDER BY amount')
      .bind(candidateId).all<{amount:number}>()).results.map(entry=>entry.amount);
    expect(deltas).toEqual([-1,1]);
    expect((await fixture.db.prepare('SELECT balance FROM duty_ops_credit_balances WHERE user_id=?')
      .bind(middle.id).first<{balance:number}>())?.balance).toBe(0);
  },40_000);

  it('supersedes a waiting three-way candidate when its last participant trades elsewhere',async()=>{
    const a=await student('waiting-a'),b=await student('waiting-b'),c=await student('waiting-c'),d=await student('waiting-d');
    const x=await duty(a),y=await duty(b,second),z=await duty(c,third);
    const w=await duty(d,new Date(Date.parse(third)+86_400_000).toISOString());
    await createIntent(fixture.db,a,'DUTY_OPS',x,[y],false);
    await createIntent(fixture.db,b,'DUTY_OPS',y,[z],false);
    const pending=await createIntent(fixture.db,c,'DUTY_OPS',z,[],false);
    const candidate=pending.candidates.find(item=>item.status==='WAITING');
    expect(candidate).toBeDefined();
    const other=await createIntent(fixture.db,d,'DUTY_OPS',w,[z],false);
    const target=(await fixture.db.prepare('SELECT id FROM exchange_v2_targets WHERE intent_id=?')
      .bind(other.id).first<{id:string}>())!.id;
    await acceptTarget(fixture.db,c,target);
    await expect(confirmCandidate(fixture.db,c,candidate!.id)).rejects.toMatchObject({status:409});
    expect((await fixture.db.prepare('SELECT status FROM exchange_v2_candidates WHERE id=?')
      .bind(candidate!.id).first<string>('status'))).toBe('SUPERSEDED');
  },40_000);

  it('rejects a targeted acceptance after target assignment details change',async()=>{
    const a=await student('changed-a'),b=await student('changed-b');
    const x=await duty(a),y=await duty(b,second);
    const request=await createIntent(fixture.db,a,'DUTY_OPS',x,[y],false);
    const target=(await fixture.db.prepare('SELECT id FROM exchange_v2_targets WHERE intent_id=?')
      .bind(request.id).first<{id:string}>())!.id;
    await fixture.db.prepare('UPDATE duty_ops_shifts SET starts_at=? WHERE id=?')
      .bind(new Date(Date.parse(second)+3600_000).toISOString(),y).run();
    await expect(acceptTarget(fixture.db,b,target)).rejects.toMatchObject({status:409});
    expect(await owner(x)).toBe(a.id);
  },40_000);

  it('checks every participant permission again at final commit',async()=>{
    const a=await student('permission-a'),b=await student('permission-b');
    const x=await duty(a),y=await duty(b,second);
    const request=await createIntent(fixture.db,a,'DUTY_OPS',x,[],false);
    const offered=await createOffer(fixture.db,b,request.id,y);
    await fixture.db.prepare(`UPDATE user_permission_overrides SET effect='DENY' WHERE user_id=?
      AND permission_key='duty_ops.swap'`).bind(b.id).run();
    await expect(confirmCandidate(fixture.db,a,offered.candidateId)).rejects.toMatchObject({status:409});
    expect(await owner(x)).toBe(a.id);expect(await owner(y)).toBe(b.id);
  },40_000);

  it('invalidates a competing open offer after its source member exchanges elsewhere',async()=>{
    const a=await student('competition-a'),b=await student('competition-b'),c=await student('competition-c');
    const x=await duty(a),y=await duty(b,second),z=await duty(c,third);
    const ai=await createIntent(fixture.db,a,'DUTY_OPS',x,[],false);
    const bi=await createIntent(fixture.db,b,'DUTY_OPS',y,[],false);
    const firstOffer=await createOffer(fixture.db,c,ai.id,z);
    const secondOffer=await createOffer(fixture.db,c,bi.id,z);
    await confirmCandidate(fixture.db,a,firstOffer.candidateId);
    await expect(confirmCandidate(fixture.db,b,secondOffer.candidateId)).rejects.toMatchObject({status:409});
    await reconcileExchangeV2(fixture.db,'DUTY_OPS');
    const stale=await fixture.db.prepare('SELECT status FROM exchange_v2_candidates WHERE id=?')
      .bind(secondOffer.candidateId).first<{status:string}>();
    expect(['SUPERSEDED','INVALIDATED']).toContain(stale?.status);
    expect(await owner(y)).toBe(b.id);
  },40_000);

  it('removes unseen irrelevant target Inbox items while retaining a read unavailable item',async()=>{
    const a=await student('inbox-a'),b=await student('inbox-b'),c=await student('inbox-c');
    const x=await duty(a),y=await duty(b,second);
    await fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?,?,?)').bind(y,c.id,now).run();
    const created=await createIntent(fixture.db,a,'DUTY_OPS',x,[y],false);
    const target=(await fixture.db.prepare('SELECT id FROM exchange_v2_targets WHERE intent_id=?')
      .bind(created.id).first<{id:string}>())!;
    const before=await fixture.db.prepare("SELECT count(*) n FROM user_inbox_items WHERE source_type='EXCHANGE' AND source_id=?")
      .bind(target.id).first<{n:number}>();expect(before?.n).toBe(2);
    await acceptTarget(fixture.db,b,target.id);
    const after=await fixture.db.prepare("SELECT count(*) n FROM user_inbox_items WHERE source_type='EXCHANGE' AND source_id=? AND user_id=?")
      .bind(target.id,c.id).first<{n:number}>();expect(after?.n).toBe(0);
    const x2=await duty(a,third),y2=await duty(b,third);
    await fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?,?,?)').bind(y2,c.id,now).run();
    const secondIntent=await createIntent(fixture.db,a,'DUTY_OPS',x2,[y2],false);
    const secondTarget=(await fixture.db.prepare('SELECT id FROM exchange_v2_targets WHERE intent_id=?')
      .bind(secondIntent.id).first<{id:string}>())!;
    await fixture.db.prepare("UPDATE user_inbox_items SET read_at=? WHERE source_type='EXCHANGE' AND source_id=? AND user_id=?")
      .bind(now,secondTarget.id,c.id).run();
    await acceptTarget(fixture.db,b,secondTarget.id);
    const inbox=await listInbox(fixture.db,c.id,new URL('https://portal.test/api/inbox'));
    expect(inbox.items.some(item=>item.title==='Swap no longer available')).toBe(true);
  },40_000);

  it('retargets Inbox membership when a different exchange changes one target assignee',async()=>{
    const a=await student('retarget-a'),b=await student('retarget-b'),c=await student('retarget-c'),d=await student('retarget-d');
    const x=await duty(a),y=await duty(b,second),w=await duty(d,third);
    await fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?,?,?)').bind(y,c.id,now).run();
    const firstIntent=await createIntent(fixture.db,a,'DUTY_OPS',x,[y],false);
    const target=(await fixture.db.prepare('SELECT id FROM exchange_v2_targets WHERE intent_id=?')
      .bind(firstIntent.id).first<{id:string}>())!.id;
    await fixture.db.prepare(`UPDATE user_inbox_items SET read_at=? WHERE source_type='EXCHANGE'
      AND source_id=? AND user_id=?`).bind(now,target,b.id).run();
    const competing=await createIntent(fixture.db,d,'DUTY_OPS',w,[y],false);
    const competingTarget=(await fixture.db.prepare('SELECT id FROM exchange_v2_targets WHERE intent_id=?')
      .bind(competing.id).first<{id:string}>())!.id;
    await acceptTarget(fixture.db,b,competingTarget);
    expect((await fixture.db.prepare('SELECT status FROM exchange_v2_targets WHERE id=?')
      .bind(target).first<string>('status'))).toBe('OPEN');
    expect((await listInbox(fixture.db,b.id,new URL('https://portal.test/api/inbox'))).items
      .some(item=>item.title==='Swap no longer available')).toBe(true);
    expect((await fixture.db.prepare(`SELECT count(*) n FROM user_inbox_items WHERE source_type='EXCHANGE'
      AND source_id=? AND user_id=? AND read_at IS NULL`).bind(target,d.id).first<{n:number}>())?.n).toBe(1);
  },40_000);

  it('rejects a claim that would cross the Duty Ops -2 credit floor',async()=>{
    const a=await student('floor-a'),b=await student('floor-b');
    for(let n=0;n<2;n++){
      const x=await duty(a,new Date(Date.parse(first)+n*86_400_000).toISOString());
      const intent=await createIntent(fixture.db,a,'DUTY_OPS',x,[],true);
      await claimGiveAway(fixture.db,b,intent.id);
    }
    const thirdShift=await duty(a,third),thirdIntent=await createIntent(fixture.db,a,'DUTY_OPS',thirdShift,[],true);
    await expect(claimGiveAway(fixture.db,b,thirdIntent.id)).rejects.toMatchObject({status:409});
    expect(await owner(thirdShift)).toBe(a.id);
    const balance=await fixture.db.prepare('SELECT balance FROM duty_ops_credit_balances WHERE user_id=?')
      .bind(a.id).first<{balance:number}>();expect(balance?.balance).toBe(-2);
  },40_000);

  it('rejects committing after a shift starts even when a waiting candidate was visible earlier',async()=>{
    const a=await student('time-a'),b=await student('time-b');const x=await duty(a),y=await duty(b,second);
    const intent=await createIntent(fixture.db,a,'DUTY_OPS',x,[],false);
    const offered=await createOffer(fixture.db,b,intent.id,y);
    vi.setSystemTime(new Date(first));
    await expect(confirmCandidate(fixture.db,a,offered.candidateId)).rejects.toMatchObject({status:409});
    expect(await owner(x)).toBe(a.id);
    expect((await listExchangeV2(fixture.db,a,'DUTY_OPS',[x])).assignmentStates
      .find(state=>state.assignmentId===x)?.availableActions).toEqual([]);
    vi.setSystemTime(new Date(now));
  },40_000);

  it('applies Flyvask membership effects without altering the FlightLogger snapshot',async()=>{
    const a=await student('fly-a'),b=await student('fly-b');await grant(a,'flyvask.swap');await grant(b,'flyvask.swap');
    const x=await fly(a),y=await fly(b,second);
    const intent=await createIntent(fixture.db,a,'FLYVASK',x,[y],false);
    const target=(await fixture.db.prepare('SELECT id FROM exchange_v2_targets WHERE intent_id=?')
      .bind(intent.id).first<{id:string}>())!;
    await acceptTarget(fixture.db,b,target.id);
    expect((await readMembers(fixture.db,'FLYVASK',x))[0].userId).toBe(b.id);
    expect((await readMembers(fixture.db,'FLYVASK',y))[0].userId).toBe(a.id);
    expect((await fixture.db.prepare('SELECT user_id FROM flyvask_assignments WHERE shift_id=?')
      .bind(x).first<string>('user_id'))).toBe(a.id);
  },40_000);

  it('commits a Brakkevakt cross-week exchange and leaves each week with distinct owners',async()=>{
    const a=await student('brakke-a'),b=await student('brakke-b'),c=await student('brakke-c'),d=await student('brakke-d');
    for(const user of [a,b,c,d])await grant(user,'brakkevakt.swap');
    const x=await brakkeWeek(a,c,'2026-10-05'),y=await brakkeWeek(b,d,'2026-10-12');
    const intent=await createIntent(fixture.db,a,'BRAKKEVAKT',x,[y],false);
    const target=(await fixture.db.prepare('SELECT id FROM exchange_v2_targets WHERE intent_id=?')
      .bind(intent.id).first<{id:string}>())!;
    await acceptTarget(fixture.db,b,target.id);
    expect((await readMembers(fixture.db,'BRAKKEVAKT',x))[0].userId).toBe(b.id);
    expect((await readMembers(fixture.db,'BRAKKEVAKT',y))[0].userId).toBe(a.id);
    const distinct=await fixture.db.prepare(`SELECT count(DISTINCT user_id) n FROM brakkevakt_assignments
      WHERE period_id=(SELECT period_id FROM brakkevakt_assignments WHERE id=?)`).bind(x).first<{n:number}>();
    expect(distinct?.n).toBe(2);
  },40_000);

  it('denies a v2 API mutation without domain permission',async()=>{
    const user=await seedCredential(fixture.db,`denied-${crypto.randomUUID()}`,'denied-token','denied@test',`fl-denied-${crypto.randomUUID()}`);
    const x=await duty(user);
    const request=new Request('https://portal.test/api/exchanges/v2/intents',{method:'POST',
      headers:{Origin:'https://portal.test','Content-Type':'application/json'},
      body:JSON.stringify({domain:'DUTY_OPS',sourceAssignmentId:x,targetAssignmentIds:[],allowGiveAway:false})});
    const response=await exchangeV2Endpoint({request,env:{DB:fixture.db,AVAILABILITY_CACHE:{} as KVNamespace,
      FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY:testEncryptionKey},
      data:{accessIdentity:{subject:user.access_subject,email:user.email}},params:{}},'intents');
    expect(response.status).toBe(403);
    expect((await listExchangeV2(fixture.db,user,'DUTY_OPS',[x])).assignmentStates[0].availableActions).toEqual([]);
  },40_000);

  it('serves a read-only filtered audit timeline only to an administrator',async()=>{
    const ownerUser=await student('audit-owner'),other=await student('audit-other'),admin=await student('audit-admin');
    const x=await duty(ownerUser),y=await duty(other,second);
    const request=await createIntent(fixture.db,ownerUser,'DUTY_OPS',x,[y],false);
    const target=(await fixture.db.prepare('SELECT id FROM exchange_v2_targets WHERE intent_id=?')
      .bind(request.id).first<{id:string}>())!.id;
    await acceptTarget(fixture.db,other,target);
    const context=(actor:ApplicationUser,path:string)=>({request:new Request(`https://portal.test${path}`),
      env:{DB:fixture.db,AVAILABILITY_CACHE:{} as KVNamespace,
        FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY:testEncryptionKey},
      data:{accessIdentity:{subject:actor.access_subject,email:actor.email}},params:{intentId:request.id}});
    expect((await auditEndpoint(context(other,'/api/admin/exchanges'),false)).status).toBe(403);
    await fixture.db.prepare(`INSERT INTO user_roles (user_id,role_id,created_at)
      SELECT ?,id,? FROM roles WHERE key='ADMIN'`).bind(admin.id,now).run();
    const list=await auditEndpoint(context(admin,
      `/api/admin/exchanges?person=${ownerUser.id}&domain=DUTY_OPS&status=COMPLETED`),false);
    expect(list.status).toBe(200);
    const cases=await list.json() as {cases:{id:string}[]};
    expect(cases.cases.some(item=>item.id===request.id)).toBe(true);
    const detail=await auditEndpoint(context(admin,`/api/admin/exchanges/${request.id}`),true);
    const caseData=await detail.json() as {events:{type:string}[];candidates:{legs:unknown[]}[]};
    expect(caseData.events.map(event=>event.type)).toContain('CANDIDATE_COMMITTED');
    expect(caseData.candidates[0].legs).toHaveLength(2);
    expect(JSON.stringify(caseData)).not.toContain('audit-owner@test');
  },40_000);
});
