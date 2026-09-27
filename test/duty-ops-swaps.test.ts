import { listSwapHistory } from '../backend/duty-ops/swap-history';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, seedCredential, testEncryptionKey, resetCreditLedger } from './d1-fixture';
import { acceptProposal, cancelExchange, claimGiveAway, createExchange, createProposal, listExchanges, withdrawProposal } from '../backend/duty-ops/swaps';
import { exchangeEndpoint } from '../backend/duty-ops/swap-api';
import { dutyWindow } from '../backend/duty-ops/window';
import type { ApplicationUser } from '../backend/users';
import { saveDiscovery } from '../backend/duty-ops/service';

const now = new Date('2026-09-27T08:00:00.000Z');
const times = { startsAt: '2026-09-28T05:00:00.000Z', endsAt: '2026-09-28T10:00:00.000Z' };
const offeredTimes = { startsAt: '2026-09-29T10:00:00.000Z', endsAt: '2026-09-29T16:00:00.000Z' };
let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let alice: ApplicationUser, bob: ApplicationUser, carl: ApplicationUser;
let a: string, b: string, c: string;
const upstream = vi.fn();
beforeAll(async () => { fixture = await createTestDatabase(); });
afterAll(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await fixture.dispose(); });
async function grant(user: ApplicationUser, effect = 'ALLOW') {
  await fixture.db.prepare(`INSERT INTO user_permission_overrides (user_id, permission_key, effect, created_at, updated_at)
    VALUES (?, 'duty_ops.swap', ?, 'test', 'test') ON CONFLICT(user_id, permission_key) DO UPDATE SET effect = excluded.effect`).bind(user.id, effect).run();
}
async function shift(user: ApplicationUser, schedule = times, status = 'OPEN') {
  const id = crypto.randomUUID();
  await fixture.db.batch([
    fixture.db.prepare(`INSERT INTO duty_ops_shifts VALUES (?, ?, ?, ?, ?, 3, NULL, ?)`).bind(id, `fl-${id}`, schedule.startsAt, schedule.endsAt, status, now.toISOString()),
    fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?, ?, ?)').bind(id, user.id, now.toISOString()),
  ]);
  return id;
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  await resetCreditLedger(fixture.db);
  await fixture.db.batch([
    fixture.db.prepare("UPDATE duty_ops_swap_requests SET type = 'GIVE_AWAY', accepted_proposal_id = NULL"),
    ...['duty_ops_swap_events', 'duty_ops_swap_reservations', 'duty_ops_swap_proposals', 'duty_ops_swap_requests', 'users', 'duty_ops_shifts', 'duty_ops_sync_state']
      .map(table => fixture.db.prepare(`DELETE FROM ${table}`)),
  ]);
  alice = await seedCredential(fixture.db, 'alice', 'alice-token', 'alice@test', 'fl-alice');
  bob = await seedCredential(fixture.db, 'bob', 'bob-token', 'bob@test', 'fl-bob');
  carl = await seedCredential(fixture.db, 'carl', 'carl-token', 'carl@test', 'fl-carl');
  for (const user of [alice, bob, carl]) {
    await grant(user);
    await fixture.db.prepare('UPDATE users SET flightlogger_first_name = ?, flightlogger_last_name = ? WHERE id = ?').bind(user.access_subject, 'Student', user.id).run();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${user.access_subject}-token`)))].map(b => b.toString(16).padStart(2, '0')).join('');
    const window = dutyWindow(new URL('https://portal.test/api/duty-ops'));
    await fixture.db.prepare('INSERT INTO duty_ops_sync_state VALUES (?, ?, ?, ?, ?, ?)').bind(`user:${user.id}`, user.id, window.startsAt, window.endsAt, hash, now.toISOString()).run();
  }
  const window = dutyWindow(new URL('https://portal.test/api/duty-ops'));
  await fixture.db.prepare('INSERT INTO duty_ops_sync_state VALUES (?, NULL, ?, ?, NULL, ?)').bind('global', window.startsAt, window.endsAt, now.toISOString()).run();
  a = await shift(alice); b = await shift(bob, offeredTimes); c = await shift(carl, offeredTimes);
  upstream.mockReset(); upstream.mockImplementation(() => { throw new Error('No live upstream calls in tests'); }); vi.stubGlobal('fetch', upstream);
});
const request = (type: 'GIVE_AWAY' | 'DIRECT_SWAP' = 'GIVE_AWAY') => createExchange(fixture.db, alice, a, type, times);
const proposal = (id: string, user = bob, shiftId = b) => createProposal(fixture.db, user, id, shiftId, offeredTimes);
async function rows(table: string) { return (await fixture.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results; }
async function assignments() { return (await fixture.db.prepare('SELECT * FROM duty_ops_assignments ORDER BY user_id, shift_id').all()).results; }
async function api(action: Parameters<typeof exchangeEndpoint>[1], actor = alice, body: unknown = {}, ids: { requestId?: string; proposalId?: string } = {}, headers: Record<string, string> = {}, method = 'POST', query = '') {
  return exchangeEndpoint({ request: new Request(`https://portal.test/api/duty-ops/swaps${query}`, { method,
    headers: { 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }),
    env: { DB: fixture.db, FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY: testEncryptionKey, AVAILABILITY_CACHE: {} as KVNamespace },
    data: { accessIdentity: { subject: actor.access_subject, email: actor.email } }, params: ids }, action);
}

describe('Duty Ops give-away agreements', () => {
  it('creates an open request and audit without altering assignments', async () => {
    const before = await assignments(); const { id } = await request();
    expect(await rows('duty_ops_swap_requests')).toMatchObject([{ id, type: 'GIVE_AWAY', status: 'OPEN', requester_user_id: alice.id }]);
    expect(await rows('duty_ops_swap_events')).toMatchObject([{ request_id: id, actor_user_id: alice.id, type: 'REQUEST_CREATED' }]);
    expect(await assignments()).toEqual(before);
  });
  it('rejects another student’s shift, nonexistent shift and stale displayed times', async () => {
    await expect(createExchange(fixture.db, bob, a, 'GIVE_AWAY', times)).rejects.toMatchObject({ status: 409 });
    await expect(createExchange(fixture.db, alice, crypto.randomUUID(), 'GIVE_AWAY', times)).rejects.toMatchObject({ status: 409 });
    await expect(createExchange(fixture.db, alice, a, 'GIVE_AWAY', offeredTimes)).rejects.toMatchObject({ status: 409 });
    expect(await rows('duty_ops_swap_events')).toEqual([]);
  });
  it.each(['CANCELLED', 'COMPLETED', 'PARTIALLY_COMPLETED'])('rejects unsuitable status %s', async status => {
    await fixture.db.prepare('UPDATE duty_ops_shifts SET status = ? WHERE id = ?').bind(status, a).run();
    await expect(request()).rejects.toMatchObject({ status: 409 });
  });
  it('rejects past, ended and already-started shifts', async () => {
    for (const startsAt of ['2026-09-26T05:00:00.000Z', now.toISOString()]) {
      const schedule = { startsAt, endsAt: times.endsAt }; const id = await shift(alice, schedule);
      await expect(createExchange(fixture.db, alice, id, 'GIVE_AWAY', schedule)).rejects.toMatchObject({ status: 409 });
    }
    const schedule = { startsAt: '2026-09-26T05:00:00.000Z', endsAt: '2026-09-26T10:00:00.000Z' };
    await expect(createExchange(fixture.db, alice, await shift(alice, schedule), 'DIRECT_SWAP', schedule)).rejects.toMatchObject({ status: 409 });
  });
  it('prevents incompatible open requests and rejects the former holder after acceptance', async () => {
    const { id } = await request();
    await expect(request('DIRECT_SWAP')).rejects.toMatchObject({ status: 409 });
    await claimGiveAway(fixture.db, bob, id);
    await expect(request()).rejects.toMatchObject({ status: 409 });
    expect((await listExchanges(fixture.db, alice)).lockedShiftIds).not.toContain(a);
  });
  it('disallows self-claims, duplicate FlightLogger identity and already-assigned recipients', async () => {
    const { id } = await request();
    await expect(claimGiveAway(fixture.db, alice, id)).rejects.toMatchObject({ status: 409 });
    await fixture.db.prepare('UPDATE users SET flightlogger_user_id = ? WHERE id = ?').bind('fl-alice', bob.id).run();
    await expect(claimGiveAway(fixture.db, bob, id)).rejects.toMatchObject({ status: 409 });
    await fixture.db.prepare('UPDATE users SET flightlogger_user_id = ? WHERE id = ?').bind('fl-bob', bob.id).run();
    await fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?, ?, ?)').bind(a, bob.id, now.toISOString()).run();
    await expect(claimGiveAway(fixture.db, bob, id)).rejects.toMatchObject({ status: 409 });
  });
  it('accepts immediately and permits exactly one concurrent claimant', async () => {
    const before = await assignments(), { id } = await request();
    const attempts = await Promise.allSettled([claimGiveAway(fixture.db, bob, id), claimGiveAway(fixture.db, carl, id)]);
    expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(r => r.status === 'rejected')).toHaveLength(1);
    const accepted = (await rows('duty_ops_swap_requests'))[0] as { accepted_by_user_id: string };
    expect([bob.id, carl.id]).toContain(accepted.accepted_by_user_id);
    expect((await rows('duty_ops_swap_events')).filter((r: any) => r.type === 'GIVE_AWAY_CLAIMED')).toHaveLength(1);
    await expect(claimGiveAway(fixture.db, bob, id)).rejects.toMatchObject({ status: 409 });
    await expect(cancelExchange(fixture.db, alice, id)).rejects.toMatchObject({ status: 409 });
    expect(await assignments()).toEqual(before);
  });
  it('only permits owner cancellation while open and releases the reservation', async () => {
    const { id } = await request();
    await expect(cancelExchange(fixture.db, bob, id)).rejects.toMatchObject({ status: 409 });
    await cancelExchange(fixture.db, alice, id);
    expect(await rows('duty_ops_swap_requests')).toMatchObject([{ status: 'CANCELLED', cancelled_at: now.toISOString() }]);
    expect((await listExchanges(fixture.db, alice)).lockedShiftIds).toEqual([]);
    await expect(claimGiveAway(fixture.db, bob, id)).rejects.toMatchObject({ status: 409 });
    await expect(request()).resolves.toHaveProperty('id');
  });
});

describe('direct swaps and transaction safety', () => {
  it('allows multiple independent proposals and returns them only to the requester or their proposer', async () => {
    const { id } = await request('DIRECT_SWAP'); const first = await proposal(id); await proposal(id, carl, c);
    expect((await listExchanges(fixture.db, alice)).requests[0].proposals).toHaveLength(2);
    expect((await listExchanges(fixture.db, bob)).requests[0].proposals.map(p => p.id)).toEqual([first.id]);
    const outsider = await seedCredential(fixture.db, 'outsider', 'outsider-token', 'secret@email', 'fl-outsider');
    expect((await listExchanges(fixture.db, outsider)).requests[0].proposals).toEqual([]);
    expect(JSON.stringify(await listExchanges(fixture.db, alice))).not.toMatch(/@|token|ciphertext|flightlogger_booking|fl-alice/);
  });
  it('requires ownership of a distinct offered shift, forbids self-proposals and duplicate open offers', async () => {
    const { id } = await request('DIRECT_SWAP');
    await expect(createProposal(fixture.db, alice, id, a, times)).rejects.toMatchObject({ status: 409 });
    await expect(proposal(id, bob, c)).rejects.toMatchObject({ status: 409 });
    await expect(createProposal(fixture.db, bob, id, a, times)).rejects.toMatchObject({ status: 409 });
    await proposal(id);
    await expect(proposal(id)).rejects.toMatchObject({ status: 409 });
    const otherRequest = await createExchange(fixture.db, carl, c, 'DIRECT_SWAP', offeredTimes);
    await expect(proposal(otherRequest.id)).rejects.toMatchObject({ status: 409 });
    await expect(createExchange(fixture.db, bob, b, 'GIVE_AWAY', offeredTimes)).rejects.toMatchObject({ status: 409 });
  });
  it('allows only the proposer to withdraw an open offer, then frees their shift', async () => {
    const { id } = await request('DIRECT_SWAP'); const p = await proposal(id);
    await expect(withdrawProposal(fixture.db, carl, id, p.id)).rejects.toMatchObject({ status: 409 });
    await withdrawProposal(fixture.db, bob, id, p.id);
    expect(await rows('duty_ops_swap_proposals')).toMatchObject([{ status: 'WITHDRAWN' }]);
    await expect(acceptProposal(fixture.db, alice, id, p.id)).rejects.toMatchObject({ status: 409 });
    await expect(createExchange(fixture.db, bob, b, 'GIVE_AWAY', offeredTimes)).resolves.toHaveProperty('id');
    expect(await rows('duty_ops_swap_events')).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'PROPOSAL_WITHDRAWN', actor_user_id: bob.id })]));
  });
  it('chooses exactly one proposal atomically, closes others and leaves assignments untouched', async () => {
    const before = await assignments(), { id } = await request('DIRECT_SWAP');
    const p = await proposal(id), other = await proposal(id, carl, c);
    await expect(acceptProposal(fixture.db, bob, id, p.id)).rejects.toMatchObject({ status: 409 });
    const attempts = await Promise.allSettled([acceptProposal(fixture.db, alice, id, p.id), acceptProposal(fixture.db, alice, id, other.id)]);
    expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const proposals = await rows('duty_ops_swap_proposals') as { id: string; status: string }[];
    expect(proposals.filter(p => p.status === 'ACCEPTED')).toHaveLength(1);
    expect(proposals.filter(p => p.status === 'NOT_SELECTED')).toHaveLength(1);
    expect(await rows('duty_ops_swap_requests')).toMatchObject([{ status: 'ACCEPTED', accepted_proposal_id: proposals.find(p => p.status === 'ACCEPTED')!.id }]);
    await expect(cancelExchange(fixture.db, alice, id)).rejects.toMatchObject({ status: 409 });
    await expect(withdrawProposal(fixture.db, bob, id, p.id)).rejects.toMatchObject({ status: 409 });
    await expect(proposal(id)).rejects.toMatchObject({ status: 409 });
    expect(await assignments()).toEqual(before);
    expect((await rows('duty_ops_swap_events')).filter((r: any) => r.type === 'PROPOSAL_ACCEPTED')).toHaveLength(1);
  });
  it.each(['requester', 'proposer'])('requires the %s assignment snapshot to still exist', async which => {
    const { id } = await request('DIRECT_SWAP'); const p = await proposal(id);
    await fixture.db.prepare('DELETE FROM duty_ops_assignments WHERE user_id = ?').bind(which === 'requester' ? alice.id : bob.id).run();
    await expect(acceptProposal(fixture.db, alice, id, p.id)).rejects.toMatchObject({ status: 409 });
    expect(await rows('duty_ops_swap_requests')).toMatchObject([{ status: 'OPEN' }]);
    expect(await rows('duty_ops_swap_proposals')).toMatchObject([{ status: 'OPEN' }]);
  });
  it.each(['CANCELLED', 'RESCHEDULED', 'STARTED'])('revalidates a changed offered shift: %s', async change => {
    const { id } = await request('DIRECT_SWAP'); const p = await proposal(id);
    if (change === 'CANCELLED') await fixture.db.prepare("UPDATE duty_ops_shifts SET status = 'CANCELLED' WHERE id = ?").bind(b).run();
    if (change === 'RESCHEDULED') await fixture.db.prepare('UPDATE duty_ops_shifts SET ends_at = ? WHERE id = ?').bind('2026-09-29T17:00:00.000Z', b).run();
    if (change === 'STARTED') vi.setSystemTime(new Date('2026-09-30T08:00:00Z'));
    await expect(acceptProposal(fixture.db, alice, id, p.id)).rejects.toMatchObject({ status: 409 });
  });
  it('rechecks requester ownership/time and permissions inside the write transaction', async () => {
    const { id } = await request();
    await grant(bob, 'DENY');
    await expect(claimGiveAway(fixture.db, bob, id)).rejects.toMatchObject({ status: 409 });
    await grant(bob);
    await fixture.db.prepare('UPDATE duty_ops_shifts SET starts_at = ? WHERE id = ?').bind('2026-09-28T06:00:00.000Z', a).run();
    await expect(claimGiveAway(fixture.db, bob, id)).rejects.toMatchObject({ status: 409 });
  });
  it('rolls the complete acceptance back if audit insertion fails', async () => {
    const { id } = await request('DIRECT_SWAP'); const p = await proposal(id); await proposal(id, carl, c);
    const before = await assignments(), reservations = await fixture.db.prepare('SELECT * FROM duty_ops_swap_reservations ORDER BY user_id').all();
    await fixture.db.prepare("CREATE TRIGGER swap_test_failure BEFORE INSERT ON duty_ops_swap_events BEGIN SELECT RAISE(ABORT, 'test audit failure'); END").run();
    try {
      await expect(acceptProposal(fixture.db, alice, id, p.id)).rejects.toThrow();
      expect(await rows('duty_ops_swap_requests')).toMatchObject([{ status: 'OPEN' }]);
      expect((await rows('duty_ops_swap_proposals') as any[]).every(p => p.status === 'OPEN')).toBe(true);
      expect((await fixture.db.prepare('SELECT * FROM duty_ops_swap_reservations ORDER BY user_id').all()).results).toEqual(reservations.results);
      expect(await assignments()).toEqual(before);
    } finally { await fixture.db.prepare('DROP TRIGGER swap_test_failure').run(); }
  });
  it('closes all open proposals on owner cancellation and releases each reservation', async () => {
    const { id } = await request('DIRECT_SWAP'); await proposal(id); await proposal(id, carl, c);
    await cancelExchange(fixture.db, alice, id);
    expect((await rows('duty_ops_swap_proposals') as any[]).every(p => p.status === 'NOT_SELECTED')).toBe(true);
    expect((await listExchanges(fixture.db, bob)).lockedShiftIds).toEqual([]);
  });
  it('retains accepted dates and audit when FlightLogger discovery removes the source booking', async () => {
    const { id } = await request(); await claimGiveAway(fixture.db, bob, id);
    await saveDiscovery(fixture.db, [], dutyWindow(new URL('https://portal.test')), now.toISOString());
    expect((await listSwapHistory(fixture.db, alice, null)).entries[0]).toMatchObject({ givenShift: { id: null, ...times } });
    expect((await listExchanges(fixture.db, alice)).requests).toEqual([]);
    expect(await rows('duty_ops_swap_events')).toHaveLength(2);
  });
  it('paginates relevant requests without exposing unrelated closed history', async () => {
    const seeds = JSON.stringify(Array.from({ length: 32 }, () => ({ shift: crypto.randomUUID(), request: crypto.randomUUID() })));
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO duty_ops_shifts SELECT json_extract(value, '$.shift'), json_extract(value, '$.shift'), ?, ?, 'OPEN', 1, NULL, ? FROM json_each(?)`)
        .bind(times.startsAt, times.endsAt, now.toISOString(), seeds),
      fixture.db.prepare(`INSERT INTO duty_ops_assignments SELECT json_extract(value, '$.shift'), ?, ? FROM json_each(?)`).bind(alice.id, now.toISOString(), seeds),
      fixture.db.prepare(`INSERT INTO duty_ops_swap_requests (id, requester_user_id, requested_shift_id, requested_starts_at, requested_ends_at, type, status, created_at, updated_at)
        SELECT json_extract(value, '$.request'), ?, json_extract(value, '$.shift'), ?, ?, 'GIVE_AWAY', 'OPEN', ?, ? FROM json_each(?)`)
        .bind(alice.id, times.startsAt, times.endsAt, now.toISOString(), now.toISOString(), seeds),
      fixture.db.prepare(`INSERT INTO duty_ops_swap_reservations SELECT ?, json_extract(value, '$.shift'), json_extract(value, '$.request'), NULL FROM json_each(?)`).bind(alice.id, seeds),
    ]);
    const first = await listExchanges(fixture.db, bob), second = await listExchanges(fixture.db, bob, first.nextCursor);
    expect(first.requests).toHaveLength(30); expect(second.requests).toHaveLength(2); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.requests, ...second.requests].map(r => r.id)).size).toBe(32);
    await cancelExchange(fixture.db, alice, first.requests[0].id);
    expect((await listExchanges(fixture.db, bob)).requests.some(r => r.id === first.requests[0].id)).toBe(false);
    await expect(listExchanges(fixture.db, bob, 'bad')).rejects.toMatchObject({ status: 400 });
  });
});

describe('same-origin exchange API and freshness', () => {
  it('requires swap permission for every mutation before credentials or FlightLogger', async () => {
    await grant(alice, 'DENY');
    for (const action of ['requests', 'claim', 'cancel', 'propose', 'accept', 'withdraw'] as const) {
      const denied = await api(action);
      expect(denied.status).toBe(403); expect(await denied.json()).toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(upstream).not.toHaveBeenCalled();
    expect((await api('requests', alice, {}, {}, {}, 'GET')).status).toBe(200);
  });
  it('fails unauthenticated calls and wrong methods safely', async () => {
    const response = await exchangeEndpoint({ request: new Request('https://portal.test/api/duty-ops/swaps'), env: {}, data: {}, params: {} } as never, 'requests');
    expect(response.status).toBe(401);
    expect((await api('claim', alice, {}, {}, {}, 'GET')).status).toBe(405);
  });
  it('strictly rejects forged fields, malformed IDs, query parameters and cross-site writes', async () => {
    const body = { shiftId: a, type: 'GIVE_AWAY', ...times };
    expect((await api('requests', alice, { ...body, userId: bob.id })).status).toBe(400);
    expect((await api('requests', alice, { ...body, type: 'UNKNOWN' })).status).toBe(400);
    expect((await api('requests', alice, { ...body, shiftId: 'bad' })).status).toBe(400);
    expect((await api('requests', alice, body, {}, {}, 'POST', '?userId=other')).status).toBe(400);
    expect((await api('requests', alice, body, {}, { Origin: 'https://evil.test' })).status).toBe(403);
    expect((await api('requests', alice, body, {}, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await api('requests', alice, body, {}, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await api('requests', alice, { blob: 'x'.repeat(3000) })).status).toBe(413);
    expect((await api('requests', alice, {}, {}, {}, 'GET', '?cursor=x&cursor=y')).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('uses fresh five-minute actor snapshots, no-store responses and safe JSON', async () => {
    const response = await api('requests', alice, { shiftId: a, type: 'GIVE_AWAY', ...times });
    expect(response.status).toBe(201); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const { id } = await response.json() as { id: string };
    const claimed = await api('claim', bob, {}, { requestId: id }); expect(claimed.status).toBe(200);
    expect(upstream).not.toHaveBeenCalled();
    expect(await (await api('requests', bob, {}, {}, {}, 'GET')).text()).not.toMatch(/token|ciphertext|@|access_subject/);
  });
  it('refreshes only the actor credential and fails closed on stale upstream data', async () => {
    await fixture.db.prepare("UPDATE duty_ops_sync_state SET last_synced_at = '2026-09-27T07:00:00.000Z'").run();
    upstream.mockImplementation(async (_url, init) => {
      expect(init.headers.Authorization).toBe('Bearer alice-token');
      return new Response('sensitive body', { status: 500 });
    });
    const response = await api('requests', alice, { shiftId: a, type: 'DIRECT_SWAP', ...times });
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: 'EXCHANGE_STALE' });
    expect(await rows('duty_ops_swap_requests')).toEqual([]);
    expect(upstream).toHaveBeenCalled();
  });
  it('keeps cancellation/withdrawal usable without upstream credentials and rejects unrelated proposals', async () => {
    const { id } = await request('DIRECT_SWAP'); const p = await proposal(id);
    await fixture.db.prepare('DELETE FROM flightlogger_credentials').run();
    expect((await api('withdraw', bob, {}, { requestId: id, proposalId: p.id })).status).toBe(200);
    expect((await api('cancel', alice, {}, { requestId: id })).status).toBe(200);
    expect(upstream).not.toHaveBeenCalled();
  });
});
