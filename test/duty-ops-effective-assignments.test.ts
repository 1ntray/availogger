import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, seedCredential, testEncryptionKey, resetCreditLedger, applyTestMigration } from './d1-fixture';
import { acceptProposal, cancelExchange, claimGiveAway, createExchange, createProposal, listExchanges } from '../backend/duty-ops/swaps';
import { listSwapHistory } from '../backend/duty-ops/swap-history';
import { readAssignmentStates } from '../backend/duty-ops/effective-assignments';
import { exchangeEndpoint } from '../backend/duty-ops/swap-api';
import { loadDutyOps, saveAssignments } from '../backend/duty-ops/service';
import { dutyWindow } from '../backend/duty-ops/window';
import type { ApplicationUser } from '../backend/users';

const now = '2026-09-27T08:00:00.000Z';
const times = { startsAt: '2026-09-28T05:00:00.000Z', endsAt: '2026-09-28T10:00:00.000Z' };
const bTimes = { startsAt: '2026-09-29T05:00:00.000Z', endsAt: '2026-09-29T10:00:00.000Z' };
let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let alice: ApplicationUser, bob: ApplicationUser, carl: ApplicationUser, other: ApplicationUser;
let a: string, b: string, c: string;
beforeAll(async () => { fixture = await createTestDatabase(); });
afterAll(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await fixture.dispose(); });
async function grant(db: D1Database, user: ApplicationUser) {
  await db.prepare("INSERT INTO user_permission_overrides (user_id, permission_key, effect, created_at, updated_at) VALUES (?, 'duty_ops.swap', 'ALLOW', ?, ?)").bind(user.id, now, now).run();
}
async function shift(db: D1Database, owner: ApplicationUser, schedule = times) {
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT INTO duty_ops_shifts VALUES (?, ?, ?, ?, \'OPEN\', 3, NULL, ?)').bind(id, `fl-${id}`, schedule.startsAt, schedule.endsAt, now),
    db.prepare('INSERT INTO duty_ops_assignments VALUES (?, ?, ?)').bind(id, owner.id, now),
  ]);
  return id;
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now));
  await resetCreditLedger(fixture.db);
  await fixture.db.batch([
    fixture.db.prepare("UPDATE duty_ops_swap_requests SET type = 'GIVE_AWAY', accepted_proposal_id = NULL"),
    ...['duty_ops_swap_events', 'duty_ops_swap_reservations', 'duty_ops_swap_proposals', 'duty_ops_swap_requests', 'users', 'duty_ops_shifts', 'duty_ops_sync_state'].map(t => fixture.db.prepare(`DELETE FROM ${t}`)),
  ]);
  const users: ApplicationUser[] = [];
  for (const name of ['alice', 'bob', 'carl', 'other']) {
    const user = await seedCredential(fixture.db, name, `${name}-token`, `${name}@test`, `fl-${name}`);
    await grant(fixture.db, user);
    await fixture.db.prepare('UPDATE users SET flightlogger_first_name = ? WHERE id = ?').bind(name, user.id).run();
    users.push(user);
  }
  [alice, bob, carl, other] = users;
  a = await shift(fixture.db, alice); b = await shift(fixture.db, bob, bTimes); c = await shift(fixture.db, carl, bTimes);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No real upstream calls'); }));
});
const create = (actor: ApplicationUser, shiftId = a, type: 'GIVE_AWAY' | 'DIRECT_SWAP' = 'GIVE_AWAY', schedule = times) => createExchange(fixture.db, actor, shiftId, type, schedule);
async function give(from: ApplicationUser, to: ApplicationUser, id = a, schedule = times) {
  const request = await create(from, id, 'GIVE_AWAY', schedule); await claimGiveAway(fixture.db, to, request.id); return request.id;
}
async function swap(from = alice, to = bob, first = a, second = b, firstTimes = times, secondTimes = bTimes) {
  const request = await create(from, first, 'DIRECT_SWAP', firstTimes);
  const proposal = await createProposal(fixture.db, to, request.id, second, secondTimes);
  await acceptProposal(fixture.db, from, request.id, proposal.id); return request.id;
}
async function members(id = a, raw = false) {
  return (await fixture.db.prepare(`SELECT user_id FROM ${raw ? 'duty_ops_assignments' : 'duty_ops_effective_assignments'} WHERE shift_id = ? ORDER BY user_id`).bind(id).all<{user_id: string}>()).results.map(r => r.user_id);
}
async function assertMembers(id: string, ...users: ApplicationUser[]) { expect(await members(id)).toEqual(users.map(u => u.id).sort()); }
async function fresh(user: ApplicationUser) {
  const window = dutyWindow(new URL('https://portal.test/api/duty-ops'));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${user.access_subject}-token`)))].map(b => b.toString(16).padStart(2, '0')).join('');
  await fixture.db.batch([
    fixture.db.prepare('INSERT OR REPLACE INTO duty_ops_sync_state VALUES (?, NULL, ?, ?, NULL, ?)').bind('global', window.startsAt, window.endsAt, now),
    fixture.db.prepare('INSERT OR REPLACE INTO duty_ops_sync_state VALUES (?, ?, ?, ?, ?, ?)').bind(`user:${user.id}`, user.id, window.startsAt, window.endsAt, hash, now),
  ]);
  return window;
}

describe('effective assignment overlay and chaining', () => {
  it('starts equal to raw data with compact unchanged source state', async () => {
    await assertMembers(a, alice);
    const read = await readAssignmentStates(fixture.db, [a], alice.id);
    expect(read(a, 3)).toMatchObject({ assignmentsDiffer: false, participantCount: 3, participants: [{ isCurrentUser: true }], flightlogger: { participantCount: 3 } });
  });
  it('transfers only one membership on a multi-person shift, preserving masked slots and the raw snapshot', async () => {
    await fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?, ?, ?)').bind(a, other.id, now).run();
    const before = await members(a, true);
    await give(alice, bob); await assertMembers(a, bob, other);
    expect(await members(a, true)).toEqual(before);
    const read = await readAssignmentStates(fixture.db, [a], bob.id);
    expect(read(a, 3)).toMatchObject({ participantCount: 3, assignmentsDiffer: true });
    expect(read(a, 3).participants.map(p => p.userId).sort()).toEqual([bob.id, other.id].sort());
    expect(read(a, 3).flightlogger.participants.map(p => p.userId).sort()).toEqual(before);
    expect(read(a, 3).participants.find(p => p.userId === bob.id)?.isCurrentUser).toBe(true);
  });
  it('immediately allows a received assignment to be given away and rejects its former raw holder', async () => {
    await give(alice, bob); await give(bob, carl); await assertMembers(a, carl);
    await expect(create(alice)).rejects.toMatchObject({ status: 409 });
    await expect(create(bob)).rejects.toMatchObject({ status: 409 });
    expect(await members(a, true)).toEqual([alice.id]);
    expect((await listSwapHistory(fixture.db, bob, null)).entries).toHaveLength(2);
    expect((await listExchanges(fixture.db, bob)).lockedShiftIds).toEqual([]);
  });
  it('allows acquired assignments as direct requests and proposals', async () => {
    await give(alice, bob);
    const open = await create(bob, a, 'DIRECT_SWAP'); await cancelExchange(fixture.db, bob, open.id);
    const request = await create(carl, c, 'DIRECT_SWAP', bTimes);
    const proposal = await createProposal(fixture.db, bob, request.id, a, times);
    await acceptProposal(fixture.db, carl, request.id, proposal.id);
    await assertMembers(a, carl); await assertMembers(c, bob);
  });
  it('transfers both direct-swap memberships and permits both sides to re-swap their received assignments', async () => {
    await swap(); await assertMembers(a, bob); await assertMembers(b, alice);
    await swap(alice, carl, b, c, bTimes, bTimes); await assertMembers(c, alice); await assertMembers(b, carl);
    await swap(bob, other, a, await shift(fixture.db, other, bTimes), times, bTimes);
    await assertMembers(a, other);
    expect(await members(a, true)).toEqual([alice.id]); expect(await members(b, true)).toEqual([bob.id]);
  });
  it('supports multi-step give-away chains and swapping back to a previous holder at one clock tick', async () => {
    await give(alice, bob); await give(bob, carl); await give(carl, alice);
    await assertMembers(a, alice);
    const history = (await listSwapHistory(fixture.db, alice, null)).entries;
    expect(history).toHaveLength(2); expect(history[0].receivedShift?.id).toBe(a);
    expect(history[0].acceptedAt > history[1].acceptedAt).toBe(true);
  });
  it.each(['original', 'intermediate', 'final'])('reconciles a complete chain against a %s FlightLogger snapshot', async stage => {
    await give(alice, bob); await give(bob, carl);
    const owner = stage === 'original' ? alice : stage === 'intermediate' ? bob : carl;
    await fixture.db.batch([fixture.db.prepare('DELETE FROM duty_ops_assignments WHERE shift_id = ?').bind(a),
      fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?, ?, ?)').bind(a, owner.id, now)]);
    await assertMembers(a, carl);
    const next = await create(carl); await claimGiveAway(fixture.db, other, next.id); await assertMembers(a, other);
  });
  it('reconciles direct-swap catch-up and a mixed chain without restoring earlier holders', async () => {
    await swap(); await give(alice, carl, b, bTimes);
    await fixture.db.batch([
      fixture.db.prepare('DELETE FROM duty_ops_assignments WHERE shift_id IN (?, ?)').bind(a, b),
      fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?, ?, ?)').bind(a, bob.id, now),
      fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?, ?, ?)').bind(b, carl.id, now),
    ]);
    await assertMembers(a, bob); await assertMembers(b, carl);
    await swap(bob, carl, a, b); await assertMembers(a, carl); await assertMembers(b, bob);
  });
  it('preserves portal effects when real snapshot sync removes an old holder and adds unrelated participants', async () => {
    await give(alice, bob); const window = await fresh(alice);
    await saveAssignments(fixture.db, alice, { id: 'fl-alice', firstName: 'alice', lastName: null }, [], window, now, 'hash');
    await fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?, ?, ?)').bind(a, other.id, now).run();
    // FlightLogger removed the source identity without observing the portal
    // receiver. The unrelated raw identity is ambiguous until more self-syncs.
    await assertMembers(a, bob); expect(await members(a, true)).toEqual([other.id]);
    const read = await readAssignmentStates(fixture.db, [a], bob.id);
    expect(read(a, 3).participantCount).toBe(3);
    expect(read(a, 3).participantIntegrity).toMatchObject({ status: 'CONFLICT', reason: 'PORTAL_SOURCE_DIVERGED' });
  });
  it('deduplicates multiple Access accounts for one FlightLogger identity when transferring', async () => {
    const alias = await seedCredential(fixture.db, 'alias', 'alias-token', 'alias@test', 'fl-alice');
    await fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?, ?, ?)').bind(a, alias.id, now).run();
    await give(alice, bob); await assertMembers(a, bob);
    await grant(fixture.db, alias); await expect(create(alias)).rejects.toMatchObject({ status: 409 });
  });
  it('returns received shifts as My shifts without changing FlightLogger fields', async () => {
    await give(alice, bob); const window = await fresh(bob);
    const data = await loadDutyOps(fixture.db, bob, 'bob-token', window);
    const received = data.shifts.find(s => s.id === a)!;
    expect(received.participants.some(p => p.isCurrentUser)).toBe(true);
    expect(received.flightlogger.participants.some(p => p.isCurrentUser)).toBe(false);
    expect(received.assignmentsDiffer).toBe(true);
    await fresh(alice);
    expect((await loadDutyOps(fixture.db, alice, 'alice-token', window)).shifts.find(s => s.id === a)?.participants.some(p => p.isCurrentUser)).toBe(false);
  });
  it('still allows exactly one concurrent claim on an acquired assignment', async () => {
    await give(alice, bob); const { id } = await create(bob);
    const result = await Promise.allSettled([claimGiveAway(fixture.db, carl, id), claimGiveAway(fixture.db, other, id)]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await members(a)).toHaveLength(1);
  });
  it('revalidates effective ownership transactionally when raw data is no longer enough', async () => {
    await give(alice, bob); const { id } = await create(bob);
    // Synthetic later accepted history invalidates this previously-open request.
    const competing = crypto.randomUUID();
    await fixture.db.prepare(`INSERT INTO duty_ops_swap_requests
      (id, requester_user_id, requested_shift_id, requested_starts_at, requested_ends_at, type, status, accepted_by_user_id, created_at, updated_at, accepted_at)
      VALUES (?, ?, ?, ?, ?, 'GIVE_AWAY', 'ACCEPTED', ?, ?, ?, '2026-09-27T08:01:00.000Z')`).bind(competing, bob.id, a, times.startsAt, times.endsAt, other.id, now, now).run();
    await expect(claimGiveAway(fixture.db, carl, id)).rejects.toMatchObject({ status: 409 });
    const own = (await listExchanges(fixture.db, bob)).requests.find(r => r.id === id)!;
    expect(own.eligible).toBe(false);
    expect((await listExchanges(fixture.db, carl)).requests.some(r => r.id === id)).toBe(false);
    await cancelExchange(fixture.db, bob, id);
  });
  it('rolls effective state back with audit failure on an acquired shift', async () => {
    await give(alice, bob); const { id } = await create(bob);
    await fixture.db.prepare("CREATE TRIGGER effective_test_failure BEFORE INSERT ON duty_ops_swap_events BEGIN SELECT RAISE(ABORT, 'audit failure'); END").run();
    try { await expect(claimGiveAway(fixture.db, carl, id)).rejects.toThrow(); await assertMembers(a, bob); }
    finally { await fixture.db.prepare('DROP TRIGGER effective_test_failure').run(); }
  });
  it('rejects direct acceptance if a later effect removed the proposer membership while raw data still has it', async () => {
    const { id } = await create(alice, a, 'DIRECT_SWAP');
    const proposal = await createProposal(fixture.db, bob, id, b, bTimes);
    await fixture.db.prepare(`INSERT INTO duty_ops_swap_requests
      (id, requester_user_id, requested_shift_id, requested_starts_at, requested_ends_at, type, status, accepted_by_user_id, created_at, updated_at, accepted_at)
      VALUES (?, ?, ?, ?, ?, 'GIVE_AWAY', 'ACCEPTED', ?, ?, ?, ?)`).bind(crypto.randomUUID(), bob.id, b, bTimes.startsAt, bTimes.endsAt, carl.id, now, now, now).run();
    expect(await members(b, true)).toEqual([bob.id]);
    await expect(acceptProposal(fixture.db, alice, id, proposal.id)).rejects.toMatchObject({ status: 409 });
    expect((await fixture.db.prepare('SELECT status FROM duty_ops_swap_requests WHERE id = ?').bind(id).first('status'))).toBe('OPEN');
    await assertMembers(a, alice); await assertMembers(b, carl);
  });
});

describe('personal history and active workspace', () => {
  it('removes accepted requests from active state and orients give-away history for both students', async () => {
    await give(alice, bob);
    expect((await listExchanges(fixture.db, alice)).requests).toEqual([]);
    expect((await listExchanges(fixture.db, bob)).requests).toEqual([]);
    expect((await listSwapHistory(fixture.db, alice, null)).entries[0]).toMatchObject({ counterparty: { id: bob.id }, givenShift: { id: a, ...times }, receivedShift: null });
    expect((await listSwapHistory(fixture.db, bob, null)).entries[0]).toMatchObject({ counterparty: { id: alice.id }, givenShift: null, receivedShift: { id: a, ...times } });
    expect((await listSwapHistory(fixture.db, other, null)).entries).toEqual([]);
  });
  it('orients direct swaps from each side and hides losing proposals from personal history', async () => {
    const { id } = await create(alice, a, 'DIRECT_SWAP');
    const p = await createProposal(fixture.db, bob, id, b, bTimes); await createProposal(fixture.db, carl, id, c, bTimes);
    await acceptProposal(fixture.db, alice, id, p.id);
    expect((await listSwapHistory(fixture.db, alice, null)).entries[0]).toMatchObject({ givenShift: { id: a }, receivedShift: { id: b } });
    expect((await listSwapHistory(fixture.db, bob, null)).entries[0]).toMatchObject({ givenShift: { id: b }, receivedShift: { id: a } });
    expect((await listSwapHistory(fixture.db, carl, null)).entries).toEqual([]);
    expect((await listExchanges(fixture.db, alice)).requests).toEqual([]);
  });
  it('preserves direct-swap history timestamps when both source bookings are deleted', async () => {
    await swap(); await fixture.db.prepare('DELETE FROM duty_ops_shifts').run();
    const history = await listSwapHistory(fixture.db, bob, null);
    expect(history.entries[0]).toMatchObject({ givenShift: { id: null, ...bTimes }, receivedShift: { id: null, ...times } });
  });
  it('permits history with view but without swap or credentials and rejects user selectors', async () => {
    await give(alice, bob); await fixture.db.prepare("UPDATE user_permission_overrides SET effect = 'DENY' WHERE user_id = ?").bind(bob.id).run();
    await fixture.db.prepare('DELETE FROM flightlogger_credentials').run();
    const context = (query = '', method = 'GET') => ({ request: new Request(`https://portal.test/api/duty-ops/swaps/history${query}`, { method }),
      env: { DB: fixture.db, AVAILABILITY_CACHE: {} as KVNamespace, FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY: testEncryptionKey }, data: { accessIdentity: { subject: bob.access_subject, email: bob.email } }, params: {} });
    const response = await exchangeEndpoint(context(), 'history');
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(JSON.stringify(await response.json())).not.toMatch(/@|token|access_subject/);
    expect((await exchangeEndpoint(context('?userId=other'), 'history')).status).toBe(400);
    expect((await exchangeEndpoint(context('', 'POST'), 'history')).status).toBe(405);
    await fixture.db.prepare("INSERT INTO user_permission_overrides (user_id, permission_key, effect, created_at, updated_at) VALUES (?, 'duty_ops.view', 'DENY', ?, ?)").bind(bob.id, now, now).run();
    expect((await exchangeEndpoint(context(), 'history')).status).toBe(403);
  });
  it('keyset-paginates accepted histories by time and stable ID without duplicates', async () => {
    const seeds = JSON.stringify(Array.from({ length: 32 }, () => crypto.randomUUID()));
    await fixture.db.prepare(`INSERT INTO duty_ops_swap_requests
      (id, requester_user_id, requested_shift_id, requested_starts_at, requested_ends_at, type, status, accepted_by_user_id, created_at, updated_at, accepted_at)
      SELECT value, ?, NULL, ?, ?, 'GIVE_AWAY', 'ACCEPTED', ?, ?, ?, ? FROM json_each(?)`).bind(alice.id, times.startsAt, times.endsAt, bob.id, now, now, now, seeds).run();
    const first = await listSwapHistory(fixture.db, bob, null), second = await listSwapHistory(fixture.db, bob, first.nextCursor);
    expect(first.entries).toHaveLength(30); expect(second.entries).toHaveLength(2); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.entries, ...second.entries].map(e => e.id)).size).toBe(32);
    await expect(listSwapHistory(fixture.db, bob, 'bad')).rejects.toMatchObject({ status: 400 });
  });
});

describe('0006 upgrade from populated v1', () => {
  it('derives existing agreements, preserves open intent and keeps v1 locks until a guarded v2 transaction', async () => {
    const legacy = await createTestDatabase(true, '0005_transport.sql');
    try {
      const from = await seedCredential(legacy.db, 'legacy-from', 'token', 'from@test', 'fl-from');
      const to = await seedCredential(legacy.db, 'legacy-to', 'token', 'to@test', 'fl-to');
      await grant(legacy.db, from); await grant(legacy.db, to);
      const shiftId = await shift(legacy.db, from), openShift = await shift(legacy.db, from, bTimes);
      const accepted = crypto.randomUUID(), open = crypto.randomUUID();
      const directA = await shift(legacy.db, from), directB = await shift(legacy.db, to, bTimes), offerShift = await shift(legacy.db, to, bTimes);
      const direct = crypto.randomUUID(), selected = crypto.randomUUID(), openProposal = crypto.randomUUID();
      await legacy.db.batch([
        legacy.db.prepare(`INSERT INTO duty_ops_swap_requests
          (id, requester_user_id, requested_shift_id, requested_starts_at, requested_ends_at, type, status, accepted_by_user_id, created_at, updated_at, accepted_at)
          VALUES (?, ?, ?, ?, ?, 'GIVE_AWAY', 'ACCEPTED', ?, ?, ?, ?)`).bind(accepted, from.id, shiftId, times.startsAt, times.endsAt, to.id, now, now, now),
        legacy.db.prepare(`INSERT INTO duty_ops_swap_requests
          (id, requester_user_id, requested_shift_id, requested_starts_at, requested_ends_at, type, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'DIRECT_SWAP', 'OPEN', ?, ?)`).bind(open, from.id, openShift, bTimes.startsAt, bTimes.endsAt, now, now),
        legacy.db.prepare('INSERT INTO duty_ops_swap_reservations VALUES (?, ?, ?, NULL)').bind(from.id, shiftId, accepted),
        legacy.db.prepare('INSERT INTO duty_ops_swap_reservations VALUES (?, ?, ?, NULL)').bind(to.id, shiftId, accepted),
        legacy.db.prepare('INSERT INTO duty_ops_swap_reservations VALUES (?, ?, ?, NULL)').bind(from.id, openShift, open),
        legacy.db.prepare(`INSERT INTO duty_ops_swap_requests
          (id, requester_user_id, requested_shift_id, requested_starts_at, requested_ends_at, type, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'DIRECT_SWAP', 'OPEN', ?, ?)`).bind(direct, from.id, directA, times.startsAt, times.endsAt, now, now),
        legacy.db.prepare('INSERT INTO duty_ops_swap_proposals VALUES (?, ?, ?, ?, ?, ?, \'ACCEPTED\', ?, ?)').bind(selected, direct, to.id, directB, bTimes.startsAt, bTimes.endsAt, now, now),
        legacy.db.prepare(`UPDATE duty_ops_swap_requests SET status = 'ACCEPTED', accepted_by_user_id = ?, accepted_proposal_id = ?, accepted_at = ? WHERE id = ?`).bind(to.id, selected, now, direct),
        legacy.db.prepare('INSERT INTO duty_ops_swap_reservations VALUES (?, ?, ?, NULL)').bind(from.id, directA, direct),
        legacy.db.prepare('INSERT INTO duty_ops_swap_reservations VALUES (?, ?, ?, ?)').bind(to.id, directB, direct, selected),
        legacy.db.prepare('INSERT INTO duty_ops_swap_reservations VALUES (?, ?, ?, ?)').bind(from.id, directB, direct, selected),
        legacy.db.prepare('INSERT INTO duty_ops_swap_reservations VALUES (?, ?, ?, ?)').bind(to.id, directA, direct, selected),
        legacy.db.prepare('INSERT INTO duty_ops_swap_proposals VALUES (?, ?, ?, ?, ?, ?, \'OPEN\', ?, ?)').bind(openProposal, open, to.id, offerShift, bTimes.startsAt, bTimes.endsAt, now, now),
        legacy.db.prepare('INSERT INTO duty_ops_swap_reservations VALUES (?, ?, ?, ?)').bind(to.id, offerShift, open, openProposal),
      ]);
      const sql = readFileSync(new URL('../migrations/0006_duty_ops_effective_assignments.sql', import.meta.url), 'utf8');
      expect(sql).not.toContain('\r');
      await legacy.db.batch(sql.split('-- statement-breakpoint').filter(s => s.trim()).map(s => legacy.db.prepare(s)));
      expect((await legacy.db.prepare('SELECT * FROM duty_ops_swap_reservations').all()).results).toHaveLength(8);
      expect((await legacy.db.prepare('SELECT * FROM duty_ops_active_swap_reservations').all()).results).toHaveLength(2);
      expect((await legacy.db.prepare('SELECT user_id FROM duty_ops_effective_assignments WHERE shift_id=?').bind(shiftId).all<{user_id:string}>()).results.map(r=>r.user_id)).toEqual([to.id]);
      // The current reader and mutations run only after every ordered migration.
      for (const migration of ['0007_flyvask.sql','0008_duty_ops_credits.sql','0009_flights_fuel.sql',
        '0010_brakkevakt.sql','0011_flight_changes.sql','0012_exchange_v2.sql',
        '0013_contact_messages.sql','0014_flight_schedule_details.sql','0015_schedule_notifications.sql',
        '0016_assignment_reconciliation.sql']) await applyTestMigration(legacy.db,migration);
      const read = await readAssignmentStates(legacy.db, [shiftId], to.id);
      expect(read(shiftId, 3).participants.map(p => p.userId)).toEqual([to.id]);
      const directRead = await readAssignmentStates(legacy.db, [directA, directB], from.id);
      expect(directRead(directA, 3).participants.map(p => p.userId)).toEqual([to.id]);
      expect(directRead(directB, 3).participants.map(p => p.userId)).toEqual([from.id]);
      await createExchange(legacy.db, to, shiftId, 'GIVE_AWAY', times);
      expect((await legacy.db.prepare('SELECT * FROM duty_ops_swap_reservations WHERE request_id = ?').bind(accepted).all()).results).toEqual([]);
      expect((await listExchanges(legacy.db, from)).requests.find(r => r.id === open)?.proposals.map(p => p.id)).toEqual([openProposal]);
      expect((await listSwapHistory(legacy.db, from, null)).entries).toHaveLength(2);
    } finally { await legacy.dispose(); }
  });
});
