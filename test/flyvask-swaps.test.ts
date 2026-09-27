import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, seedCredential, testEncryptionKey } from './d1-fixture';
import { acceptProposal, cancelExchange, createExchange, createProposal, listExchanges, withdrawProposal } from '../backend/flyvask/swaps';
import { exchangeEndpoint } from '../backend/flyvask/swap-api';
import { listSwapHistory } from '../backend/flyvask/swap-history';
import { readAssignmentStates } from '../backend/flyvask/effective-assignments';
import { loadFlyvask } from '../backend/flyvask/service';
import { flyvaskWindow } from '../backend/flyvask/window';
import { onRequest as scheduleRoute } from '../functions/api/flyvask';
import type { ApplicationUser } from '../backend/users';

const now = new Date('2026-09-27T08:00:00.000Z');
const times = { startsAt: '2026-10-17T16:00:00.000Z', endsAt: '2026-10-17T18:00:00.000Z' };
const later = { startsAt: '2026-10-24T16:00:00.000Z', endsAt: '2026-10-24T18:00:00.000Z' };
let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let alice: ApplicationUser, bob: ApplicationUser, carl: ApplicationUser;
let a: string, b: string, c: string;
const upstream = vi.fn();
beforeAll(async () => { fixture = await createTestDatabase(); });
afterAll(async () => { await fixture.dispose(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function shift(user: ApplicationUser, schedule = times, status = 'OPEN') {
  const id = crypto.randomUUID();
  await fixture.db.batch([
    fixture.db.prepare('INSERT INTO flyvask_shifts VALUES (?, ?, ?, ?, ?, 14, NULL, ?, ?, ?)').bind(id, `fl-${id}`, schedule.startsAt, schedule.endsAt, status, '602', 'Hangar UTSA', now.toISOString()),
    fixture.db.prepare('INSERT INTO flyvask_assignments VALUES (?, ?, ?)').bind(id, user.id, now.toISOString()),
  ]); return id;
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  await fixture.db.batch([
    fixture.db.prepare("UPDATE flyvask_swap_requests SET status='CANCELLED', accepted_by_user_id=NULL, accepted_proposal_id=NULL, accepted_at=NULL"),
    ...['flyvask_swap_events','flyvask_swap_reservations','flyvask_swap_proposals','flyvask_swap_requests','users','flyvask_shifts','flyvask_sync_state'].map(table => fixture.db.prepare(`DELETE FROM ${table}`)),
  ]);
  alice = await seedCredential(fixture.db, 'alice', 'alice-token', 'alice@test', 'fl-alice');
  bob = await seedCredential(fixture.db, 'bob', 'bob-token', 'bob@test', 'fl-bob');
  carl = await seedCredential(fixture.db, 'carl', 'carl-token', 'carl@test', 'fl-carl');
  const window = flyvaskWindow(new URL('https://portal.test/api/flyvask'));
  for (const user of [alice,bob,carl]) {
    await fixture.db.prepare('UPDATE users SET flightlogger_first_name = ?, flightlogger_last_name = ? WHERE id = ?').bind(user.access_subject, 'Student', user.id).run();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${user.access_subject}-token`)))].map(b => b.toString(16).padStart(2,'0')).join('');
    await fixture.db.prepare('INSERT INTO flyvask_sync_state VALUES (?, ?, ?, ?, ?, ?)').bind(`user:${user.id}`,user.id,window.startsAt,window.endsAt,hash,now.toISOString()).run();
  }
  await fixture.db.prepare('INSERT INTO flyvask_sync_state VALUES (?, NULL, ?, ?, NULL, ?)').bind('global',window.startsAt,window.endsAt,now.toISOString()).run();
  a = await shift(alice); b = await shift(bob,later); c = await shift(carl,later);
  upstream.mockReset(); upstream.mockImplementation(() => { throw new Error('No live upstream'); }); vi.stubGlobal('fetch',upstream);
});
const request = () => createExchange(fixture.db,alice,a,times);
const propose = (id: string, user = bob, shiftId = b) => createProposal(fixture.db,user,id,shiftId,later);
const rows = async (table: string) => (await fixture.db.prepare(`SELECT * FROM ${table}`).all()).results;
const members = async (shiftId: string) => (await fixture.db.prepare('SELECT user_id FROM flyvask_effective_assignments WHERE shift_id = ? ORDER BY user_id').bind(shiftId).all<{user_id:string}>()).results.map(p=>p.user_id);
async function deny(user: ApplicationUser, permission = 'flyvask.swap') {
  await fixture.db.prepare('INSERT INTO user_permission_overrides VALUES (?, ?, ?, ?, ?, NULL)').bind(user.id,permission,'DENY','test','test').run();
}
async function api(action: Parameters<typeof exchangeEndpoint>[1], actor = alice, body: unknown = {}, ids = {}, method = 'POST', query = '', headers = {}) {
  return exchangeEndpoint({ request: new Request(`https://portal.test/api/flyvask/swaps${query}`,{method,headers:{'Content-Type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})}),
    env:{DB:fixture.db,FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY:testEncryptionKey,AVAILABILITY_CACHE:{} as KVNamespace},data:{accessIdentity:{subject:actor.access_subject,email:actor.email}},params:ids },action);
}

describe('Flyvask direct-only agreements and effective assignments', () => {
  it('grants view and swap to students/admin and uses independent tables/state', async () => {
    const keys = (await fixture.db.prepare("SELECT permission_key FROM effective_user_permissions WHERE user_id=? AND permission_key LIKE 'flyvask.%'").bind(alice.id).all<{permission_key:string}>()).results.map(p=>p.permission_key);
    expect(keys.sort()).toEqual(['flyvask.swap','flyvask.view']);
    expect((await fixture.db.prepare("SELECT COUNT(*) n FROM role_permissions WHERE role_id='system-admin' AND permission_key LIKE 'flyvask.%'").first('n'))).toBe(2);
    expect(await members(a)).toEqual([alice.id]); expect(await rows('duty_ops_assignments')).toEqual([]);
  });
  it('creates a request with audit and rejects unowned/nonexistent/rescheduled shifts', async () => {
    const {id}=await request();
    expect(await rows('flyvask_swap_events')).toMatchObject([{type:'REQUEST_CREATED',actor_user_id:alice.id,request_id:id}]);
    for (const [actor,shiftId,schedule] of [[bob,a,times],[alice,crypto.randomUUID(),times],[alice,a,later]] as const) {
      await expect(createExchange(fixture.db,actor,shiftId,schedule)).rejects.toMatchObject({status:409});
    }
    expect(await rows('flyvask_swap_requests')).toHaveLength(1);
  });
  it.each(['CANCELLED','COMPLETED','PARTIALLY_COMPLETED'])('rejects %s bookings', async status => {
    await fixture.db.prepare('UPDATE flyvask_shifts SET status=? WHERE id=?').bind(status,a).run(); await expect(request()).rejects.toMatchObject({status:409});
  });
  it('rejects past/started shifts and incompatible active intent', async () => {
    for (const start of ['2026-09-26T08:00:00.000Z',now.toISOString()]) {
      const schedule={startsAt:start,endsAt:times.endsAt}; const id=await shift(alice,schedule);
      await expect(createExchange(fixture.db,alice,id,schedule)).rejects.toMatchObject({status:409});
    }
    await request(); await expect(request()).rejects.toMatchObject({status:409});
  });
  it('allows multiple proposals, rejects self/unowned/same-shift/already-assigned/duplicate offers', async () => {
    const {id}=await request(); await propose(id); await propose(id,carl,c);
    expect((await listExchanges(fixture.db,alice)).requests[0].proposals).toHaveLength(2);
    for (const [actor,shiftId,schedule] of [[alice,a,times],[carl,b,later],[bob,a,times],[bob,b,later]] as const) {
      await expect(createProposal(fixture.db,actor,id,shiftId,schedule)).rejects.toMatchObject({status:409});
    }
    await expect(createExchange(fixture.db,bob,b,later)).rejects.toMatchObject({status:409});
  });
  it('atomically selects one proposal, preserves others on the shift, raw snapshots and audit', async () => {
    const dan = await seedCredential(fixture.db, 'dan', 'dan-token', 'dan@test', 'fl-dan');
    await fixture.db.prepare('INSERT INTO flyvask_assignments VALUES (?, ?, ?)').bind(a,dan.id,now.toISOString()).run();
    const before=await rows('flyvask_assignments'); const {id}=await request(); const p=await propose(id); const other=await propose(id,carl,c);
    await acceptProposal(fixture.db,alice,id,p.id);
    expect(new Set(await members(a))).toEqual(new Set([bob.id,dan.id])); expect(await members(b)).toEqual([alice.id]);
    expect(await rows('flyvask_assignments')).toEqual(before); expect(await rows('flyvask_swap_reservations')).toEqual([]);
    expect(await rows('flyvask_swap_proposals')).toEqual(expect.arrayContaining([expect.objectContaining({id:p.id,status:'ACCEPTED'}),expect.objectContaining({id:other.id,status:'NOT_SELECTED'})]));
    expect(await rows('flyvask_swap_events')).toEqual(expect.arrayContaining([expect.objectContaining({type:'PROPOSAL_ACCEPTED',proposal_id:p.id})]));
    expect((await listExchanges(fixture.db,alice)).requests).toEqual([]);
    for(const operation of [()=>cancelExchange(fixture.db,alice,id),()=>withdrawProposal(fixture.db,bob,id,p.id),()=>propose(id,carl,c),()=>acceptProposal(fixture.db,alice,id,p.id)]) await expect(operation()).rejects.toMatchObject({status:409});
  });
  it('chains on both acquired legs and survives intermediate/final catch-up and a return swap', async () => {
    const first=await request(); const p=await propose(first.id); await acceptProposal(fixture.db,alice,first.id,p.id);
    await expect(createExchange(fixture.db,alice,a,times)).rejects.toMatchObject({status:409});
    const bobRequest=await createExchange(fixture.db,bob,a,times); await cancelExchange(fixture.db,bob,bobRequest.id);
    const second=await createExchange(fixture.db,alice,b,later); const q=await propose(second.id,carl,c); await acceptProposal(fixture.db,alice,second.id,q.id);
    expect(await members(a)).toEqual([bob.id]); expect(await members(b)).toEqual([carl.id]); expect(await members(c)).toEqual([alice.id]);
    const reconcile=async (state: [string,ApplicationUser][])=>{await fixture.db.batch([fixture.db.prepare('DELETE FROM flyvask_assignments'),...state.map(([s,u])=>fixture.db.prepare('INSERT INTO flyvask_assignments VALUES (?, ?, ?)').bind(s,u.id,now.toISOString()))]);};
    for(const state of [[[a,bob],[b,alice],[c,carl]],[[a,bob],[b,carl],[c,alice]]] as [string,ApplicationUser][][]){ await reconcile(state); expect(await members(a)).toEqual([bob.id]); expect(await members(b)).toEqual([carl.id]); expect(await members(c)).toEqual([alice.id]); }
    const back=await createExchange(fixture.db,bob,a,times); const backOffer=await createProposal(fixture.db,alice,back.id,c,later); await acceptProposal(fixture.db,bob,back.id,backOffer.id);
    expect(await members(a)).toEqual([alice.id]); expect(await members(c)).toEqual([bob.id]);
    expect((await listSwapHistory(fixture.db,alice,null)).entries).toHaveLength(3);
  });
  it('keeps masked counts and actor relevance in the authoritative read model', async () => {
    const {id}=await request(); const p=await propose(id); await acceptProposal(fixture.db,alice,id,p.id);
    const state=await readAssignmentStates(fixture.db,[a,b],alice.id);
    expect(state(a,14)).toMatchObject({participantCount:14,assignmentsDiffer:true,participants:[{userId:bob.id,isCurrentUser:false}],flightlogger:{participants:[{userId:alice.id,isCurrentUser:true}]}});
    const result=await loadFlyvask(fixture.db,alice,'alice-token',flyvaskWindow(new URL('https://portal.test/api/flyvask')));
    expect(result.shifts.find(s=>s.id===b)?.participants[0].isCurrentUser).toBe(true); expect(result.shifts.find(s=>s.id===a)?.participants[0].isCurrentUser).toBe(false);
    expect(result.shifts[0]).toMatchObject({classroomId:'602',classroomName:'Hangar UTSA'}); expect(upstream).not.toHaveBeenCalled();
  });
  it('cancels/withdraws only by owners, closes proposals and releases locks without credentials', async () => {
    const {id}=await request(); const p=await propose(id); const q=await propose(id,carl,c);
    await expect(cancelExchange(fixture.db,bob,id)).rejects.toMatchObject({status:409});
    await expect(withdrawProposal(fixture.db,carl,id,p.id)).rejects.toMatchObject({status:409});
    await fixture.db.prepare('DELETE FROM flightlogger_credentials').run();
    expect((await api('withdraw',bob,{}, {requestId:id,proposalId:p.id})).status).toBe(200);
    expect((await api('cancel',alice,{}, {requestId:id})).status).toBe(200);
    expect(await rows('flyvask_swap_proposals')).toEqual(expect.arrayContaining([expect.objectContaining({id:p.id,status:'WITHDRAWN'}),expect.objectContaining({id:q.id,status:'NOT_SELECTED'})]));
    expect(await rows('flyvask_swap_reservations')).toEqual([]); expect((await listExchanges(fixture.db,bob)).requests).toEqual([]); expect(upstream).not.toHaveBeenCalled();
  });
  it('allows an invalid OPEN owner request to be cancelled', async () => {
    const {id}=await request(); await fixture.db.prepare('DELETE FROM flyvask_assignments WHERE user_id=?').bind(alice.id).run();
    expect((await listExchanges(fixture.db,alice)).requests[0].eligible).toBe(false); expect((await listExchanges(fixture.db,bob)).requests).toEqual([]); await cancelExchange(fixture.db,alice,id);
  });
  it.each(['requester','proposer','time','status'])('rechecks %s at acceptance', async change => {
    const {id}=await request(); const p=await propose(id);
    if(change==='requester'||change==='proposer') await fixture.db.prepare('DELETE FROM flyvask_assignments WHERE user_id=?').bind(change==='requester'?alice.id:bob.id).run();
    else if(change==='time') await fixture.db.prepare('UPDATE flyvask_shifts SET ends_at=? WHERE id=?').bind('2026-10-24T19:00:00.000Z',b).run();
    else await fixture.db.prepare("UPDATE flyvask_shifts SET status='CANCELLED' WHERE id=?").bind(a).run();
    await expect(acceptProposal(fixture.db,alice,id,p.id)).rejects.toMatchObject({status:409});
    expect((await rows('flyvask_swap_requests'))[0]).toMatchObject({status:'OPEN'});
  });
  it('accepts exactly one concurrent selection', async () => {
    const {id}=await request(); const p=await propose(id); const q=await propose(id,carl,c);
    const results=await Promise.allSettled([acceptProposal(fixture.db,alice,id,p.id),acceptProposal(fixture.db,alice,id,q.id)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1); expect((await rows('flyvask_swap_proposals')).filter(p=>p.status==='ACCEPTED')).toHaveLength(1);
  });
  it('rolls back acceptance/effects/locks if audit insert fails', async () => {
    const {id}=await request(); const p=await propose(id); const before=await rows('flyvask_swap_reservations');
    await fixture.db.prepare("CREATE TRIGGER fail_flyvask_audit BEFORE INSERT ON flyvask_swap_events WHEN NEW.type='PROPOSAL_ACCEPTED' BEGIN SELECT RAISE(ABORT, 'audit failure'); END").run();
    try { await expect(acceptProposal(fixture.db,alice,id,p.id)).rejects.toThrow('audit failure'); expect(await members(a)).toEqual([alice.id]); expect(await rows('flyvask_swap_reservations')).toEqual(before); expect((await rows('flyvask_swap_proposals'))[0]).toMatchObject({status:'OPEN'}); }
    finally {await fixture.db.prepare('DROP TRIGGER fail_flyvask_audit').run();}
  });
});

describe('Flyvask API and personal history',()=>{
  it('requires independent permissions and rejects every mutation without swap',async()=>{
    await deny(alice); for(const action of ['requests','cancel','propose','accept','withdraw'] as const) expect((await api(action)).status).toBe(403);
    expect((await api('history',alice,{}, {},'GET')).status).toBe(200); expect(upstream).not.toHaveBeenCalled();
    await deny(alice,'flyvask.view'); expect((await api('history',alice,{}, {},'GET')).status).toBe(403);
  });
  it('requires verified identity, rejects wrong methods and no give-away/forged/CSRF fields',async()=>{
    expect((await exchangeEndpoint({request:new Request('https://portal.test/api/flyvask/swaps'),env:{},data:{},params:{}} as never,'requests')).status).toBe(401);
    expect((await api('accept',alice,{}, {},'GET')).status).toBe(405);
    for(const body of [{shiftId:a,...times,type:'GIVE_AWAY'},{shiftId:a,...times,type:'DIRECT_SWAP'},{shiftId:a,...times,userId:bob.id},{shiftId:'bad',...times}]) expect((await api('requests',alice,body)).status).toBe(400);
    expect((await api('requests',alice,{shiftId:a,...times},{},'POST','',{Origin:'https://evil.test'})).status).toBe(403);
    expect((await api('requests',alice,{shiftId:a,...times},{},'POST','',{'Sec-Fetch-Site':'cross-site'})).status).toBe(403);
    expect((await api('requests',alice,{blob:'x'.repeat(3000)})).status).toBe(413);
    expect((await api('history',alice,{}, {},'GET','?userId=other')).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('uses fresh actor-only snapshots and safe/no-store schedule and mutations',async()=>{
    const response=await api('requests',alice,{shiftId:a,...times}); expect(response.status).toBe(201); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const context={request:new Request('https://portal.test/api/flyvask'),env:{DB:fixture.db,FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY:testEncryptionKey},data:{accessIdentity:{subject:alice.access_subject,email:alice.email}}};
    const schedule=await scheduleRoute(context as never); expect(schedule.status).toBe(200); expect(schedule.headers.get('Cache-Control')).toBe('no-store'); expect(await schedule.text()).not.toMatch(/ciphertext|@|fl-alice|externalReference|booking_id/); expect(upstream).not.toHaveBeenCalled();
  });
  it('fails closed on stale synchronization and uses only the actor credential',async()=>{
    await fixture.db.prepare("UPDATE flyvask_sync_state SET last_synced_at='2026-09-27T07:00:00.000Z'").run();
    upstream.mockImplementation(async(_url,init)=>{expect(init.headers.Authorization).toBe('Bearer alice-token'); return new Response('private failure',{status:500});});
    const response=await api('requests',alice,{shiftId:a,...times}); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({code:'EXCHANGE_STALE'}); expect(await rows('flyvask_swap_requests')).toEqual([]);
  });
  it('orients accepted history for both parties, excludes others and survives deleted source FKs',async()=>{
    const {id}=await request(); const p=await propose(id); await propose(id,carl,c); await acceptProposal(fixture.db,alice,id,p.id);
    expect((await listSwapHistory(fixture.db,alice,null)).entries[0]).toMatchObject({counterparty:{id:bob.id},givenShift:{id:a,...times},receivedShift:{id:b,...later}});
    expect((await listSwapHistory(fixture.db,bob,null)).entries[0]).toMatchObject({counterparty:{id:alice.id},givenShift:{id:b,...later},receivedShift:{id:a,...times}});
    expect((await listSwapHistory(fixture.db,carl,null)).entries).toEqual([]);
    await fixture.db.prepare('DELETE FROM flyvask_shifts').run(); await fixture.db.prepare('DELETE FROM flightlogger_credentials').run(); await deny(alice);
    const response=await api('history',alice,{}, {},'GET'); expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(await response.json()).toMatchObject({entries:[{givenShift:{id:null,...times},receivedShift:{id:null,...later}}]});
  });
  it('paginates accepted personal history and active intent by stable keysets',async()=>{
    // Pagination fixtures are batched; transitions and concurrency are tested above.
    const statements: D1PreparedStatement[] = [];
    for (let i=0; i<32; i++) {
      const id=crypto.randomUUID(), proposal=crypto.randomUUID();
      statements.push(
        fixture.db.prepare("INSERT INTO flyvask_swap_requests VALUES (?, ?, ?, ?, ?, 'OPEN', NULL, NULL, ?, ?, NULL, NULL)").bind(id,alice.id,a,times.startsAt,times.endsAt,now.toISOString(),now.toISOString()),
        fixture.db.prepare("INSERT INTO flyvask_swap_proposals VALUES (?, ?, ?, ?, ?, ?, 'ACCEPTED', ?, ?)").bind(proposal,id,bob.id,b,later.startsAt,later.endsAt,now.toISOString(),now.toISOString()),
        fixture.db.prepare("UPDATE flyvask_swap_requests SET status='ACCEPTED', accepted_by_user_id=?, accepted_proposal_id=?, accepted_at=? WHERE id=?").bind(bob.id,proposal,now.toISOString(),id),
      );
    }
    await fixture.db.batch(statements);
    const first=await listSwapHistory(fixture.db,alice,null),second=await listSwapHistory(fixture.db,alice,first.nextCursor);
    expect(first.entries).toHaveLength(30); expect(second.entries).toHaveLength(2); expect(second.nextCursor).toBeNull(); expect(new Set([...first.entries,...second.entries].map(e=>e.id)).size).toBe(32);
    await expect(listSwapHistory(fixture.db,alice,'bad')).rejects.toMatchObject({status:400});
    await fixture.db.batch(Array.from({length:32},()=>fixture.db.prepare("INSERT INTO flyvask_swap_requests VALUES (?, ?, ?, ?, ?, 'OPEN', NULL, NULL, ?, ?, NULL, NULL)").bind(crypto.randomUUID(),alice.id,a,times.startsAt,times.endsAt,now.toISOString(),now.toISOString())));
    const active=await listExchanges(fixture.db,alice),next=await listExchanges(fixture.db,alice,active.nextCursor); expect(active.requests).toHaveLength(30); expect(next.requests).toHaveLength(2);
  }, 30_000);
});
