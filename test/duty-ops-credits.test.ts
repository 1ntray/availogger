import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, seedCredential, resetCreditLedger, applyTestMigration, testEncryptionKey } from './d1-fixture';
import { acceptProposal, cancelExchange, claimGiveAway, createExchange, createProposal, listExchanges, withdrawProposal } from '../backend/duty-ops/swaps';
import { creditStandings, creditSummary, listCredits, reconcileCoverage } from '../backend/duty-ops/credits';
import { creditEndpoint } from '../backend/duty-ops/credit-api';
import { createExchange as createFlyvask, createProposal as proposeFlyvask, acceptProposal as acceptFlyvask } from '../backend/flyvask/swaps';
import type { ApplicationUser } from '../backend/users';
import type { AccessData } from '../backend/env';

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let alice: ApplicationUser, bob: ApplicationUser, carl: ApplicationUser;
const now = '2026-09-27T08:00:00.000Z';
const times = { startsAt: '2026-10-01T05:00:00.000Z', endsAt: '2026-10-01T10:00:00.000Z' };
beforeAll(async () => { fixture = await createTestDatabase(); });
afterAll(async () => { vi.useRealTimers(); await fixture.dispose(); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  await resetCreditLedger(fixture.db);
  await fixture.db.batch([
    fixture.db.prepare("UPDATE duty_ops_swap_requests SET type = 'GIVE_AWAY', accepted_proposal_id = NULL"),
    fixture.db.prepare('UPDATE flyvask_swap_requests SET accepted_proposal_id = NULL, status = \'OPEN\', accepted_by_user_id = NULL, accepted_at = NULL'),
    ...['flyvask_swap_events', 'flyvask_swap_reservations', 'flyvask_swap_proposals', 'flyvask_swap_requests', 'flyvask_shifts'].map(table => fixture.db.prepare(`DELETE FROM ${table}`)),
    ...['duty_ops_swap_events', 'duty_ops_swap_reservations', 'duty_ops_swap_proposals', 'duty_ops_swap_requests', 'users', 'duty_ops_shifts']
      .map(table => fixture.db.prepare(`DELETE FROM ${table}`)),
  ]);
  alice = await seedCredential(fixture.db, 'alice', 'secret-alice', 'private-alice@test', 'fl-alice');
  bob = await seedCredential(fixture.db, 'bob', 'secret-bob', 'private-bob@test', 'fl-bob');
  carl = await seedCredential(fixture.db, 'carl', 'secret-carl', 'private-carl@test', 'fl-carl');
  for (const user of [alice, bob, carl]) await fixture.db.batch([
    fixture.db.prepare("INSERT INTO user_permission_overrides VALUES (?, 'duty_ops.swap', 'ALLOW', ?, ?, NULL)").bind(user.id, now, now),
    fixture.db.prepare('UPDATE users SET flightlogger_first_name = ?, flightlogger_last_name = ? WHERE id = ?').bind(user.access_subject, 'Student', user.id),
  ]);
});
async function shift(user: ApplicationUser) {
  const id = crypto.randomUUID();
  await fixture.db.batch([
    fixture.db.prepare('INSERT INTO duty_ops_shifts VALUES (?, ?, ?, ?, ?, 1, NULL, ?)').bind(id, `booking-${id}`, times.startsAt, times.endsAt, 'OPEN', now),
    fixture.db.prepare('INSERT INTO duty_ops_assignments VALUES (?, ?, ?)').bind(id, user.id, now),
  ]); return id;
}
async function give(user = alice) { const shiftId = await shift(user); return { ...(await createExchange(fixture.db, user, shiftId, 'GIVE_AWAY', times)), shiftId }; }
async function legacy(db: D1Database, owner: ApplicationUser, recipient: ApplicationUser, acceptedAt = now) {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO duty_ops_swap_requests
    (id, requester_user_id, requested_starts_at, requested_ends_at, type, status, accepted_by_user_id, created_at, updated_at, accepted_at)
    VALUES (?, ?, ?, ?, 'GIVE_AWAY', 'ACCEPTED', ?, ?, ?, ?)`)
    .bind(id, owner.id, times.startsAt, times.endsAt, recipient.id, acceptedAt, acceptedAt, acceptedAt).run();
  return id;
}
async function debt(count: number, owner = alice, recipient = bob) { for (let i = 0; i < count; i++) await legacy(fixture.db, owner, recipient); await reconcileCoverage(fixture.db); }
async function ledger() { return (await fixture.db.prepare('SELECT * FROM duty_ops_credit_transactions ORDER BY id').all()).results; }
async function api(query = '', actor: ApplicationUser | null = alice, standings = false, method = 'GET') {
  return creditEndpoint({ request: new Request(`https://portal.test/api/duty-ops/credits${query}`, { method }),
    env: { DB: fixture.db, FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY: testEncryptionKey, AVAILABILITY_CACHE: {} as KVNamespace },
    data: actor ? { accessIdentity: { subject: actor.access_subject, email: actor.email } } : {} as AccessData }, standings);
}

describe('immutable Duty Ops coverage ledger and floor', () => {
  it('commits exactly two opposite parties, accepted timestamp and audit with the effective assignment', async () => {
    const r = await give(); await claimGiveAway(fixture.db, bob, r.id);
    const rows = await ledger(); expect(rows).toHaveLength(2);
    const request = await fixture.db.prepare('SELECT accepted_at FROM duty_ops_swap_requests WHERE id = ?').bind(r.id).first<any>();
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: alice.id, amount: -1, counterparty_user_id: bob.id, created_at: request.accepted_at }),
      expect.objectContaining({ user_id: bob.id, amount: 1, counterparty_user_id: alice.id, created_at: request.accepted_at }),
    ]));
    expect(await fixture.db.prepare("SELECT created_at FROM duty_ops_swap_events WHERE request_id = ? AND type = 'GIVE_AWAY_CLAIMED'").bind(r.id).first('created_at')).toBe(request.accepted_at);
    expect(await fixture.db.prepare('SELECT user_id FROM duty_ops_effective_assignments WHERE shift_id = ?').bind(r.shiftId).first('user_id')).toBe(bob.id);
    expect(await creditSummary(fixture.db, alice)).toEqual({ balance: -1, coveredCount: 0, receivedCount: 1 });
    expect(await creditSummary(fixture.db, bob)).toEqual({ balance: 1, coveredCount: 1, receivedCount: 0 });
    await expect(claimGiveAway(fixture.db, carl, r.id)).rejects.toMatchObject({ status: 409 });
    expect(await ledger()).toHaveLength(2);
    await expect(fixture.db.prepare('UPDATE duty_ops_credit_transactions SET amount = amount').run()).rejects.toThrow('immutable');
    await expect(fixture.db.prepare('DELETE FROM duty_ops_credit_transactions').run()).rejects.toThrow('immutable');
    await expect(fixture.db.prepare('INSERT INTO duty_ops_credit_transactions SELECT * FROM duty_ops_credit_transactions LIMIT 1').run()).rejects.toThrow('UNIQUE');
  });
  it.each([0, 1])('allows give-away at balance %s above the floor', async count => {
    await debt(count); const r = await give(); await claimGiveAway(fixture.db, carl, r.id);
    expect((await creditSummary(fixture.db, alice)).balance).toBe(-count - 1);
  });
  it.each([2, 3])('blocks new negative operations at legacy balance -%s but permits earning', async count => {
    await debt(count); const id = await shift(alice);
    await expect(createExchange(fixture.db, alice, id, 'GIVE_AWAY', times)).rejects.toMatchObject({ code: 'DUTY_OPS_CREDIT_FLOOR' });
    const r = await give(carl); await claimGiveAway(fixture.db, alice, r.id);
    expect((await creditSummary(fixture.db, alice)).balance).toBe(1 - count);
  });
  it('rechecks an existing give-away at acceptance, keeps it open and restores eligibility after earning', async () => {
    const r = await give(); await debt(2);
    const own = (await listExchanges(fixture.db, alice)).requests.find(x => x.id === r.id)!;
    expect(own).toMatchObject({ eligible: false, ineligibleReason: 'CREDIT_FLOOR', status: 'OPEN' });
    const other = (await listExchanges(fixture.db, carl)).requests.find(x => x.id === r.id)!;
    expect(other).toMatchObject({ eligible: false, ineligibleReason: null });
    await expect(claimGiveAway(fixture.db, carl, r.id)).rejects.toMatchObject({ code: 'DUTY_OPS_CREDIT_FLOOR' });
    const earn = await give(carl); await claimGiveAway(fixture.db, alice, earn.id);
    expect((await listExchanges(fixture.db, alice)).requests.find(x => x.id === r.id)?.eligible).toBe(true);
    await claimGiveAway(fixture.db, carl, r.id);
    expect((await creditSummary(fixture.db, alice)).balance).toBe(-2);
  });
  it('allows exactly one of concurrent claims on different requests when only one debit remains', async () => {
    await debt(1); const one = await give(), two = await give();
    const results = await Promise.allSettled([claimGiveAway(fixture.db, bob, one.id), claimGiveAway(fixture.db, carl, two.id)]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect((await creditSummary(fixture.db, alice)).balance).toBe(-2);
    expect(await ledger()).toHaveLength(4);
  });
  it('gives only the winning concurrent claimant a credit', async () => {
    const r = await give(); const results = await Promise.allSettled([claimGiveAway(fixture.db, bob, r.id), claimGiveAway(fixture.db, carl, r.id)]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(await ledger()).toHaveLength(2);
    expect((await creditSummary(fixture.db, bob)).balance + (await creditSummary(fixture.db, carl)).balance).toBe(1);
  });
  it.each(['ledger', 'audit'])('rolls back the assignment, acceptance, reservations and credits after a %s failure', async failure => {
    const r = await give(); const target = failure === 'ledger' ? 'duty_ops_credit_transactions' : 'duty_ops_swap_events';
    await fixture.db.prepare(`CREATE TRIGGER test_credit_failure BEFORE INSERT ON ${target} BEGIN SELECT RAISE(ABORT, 'injected_failure'); END`).run();
    try { await expect(claimGiveAway(fixture.db, bob, r.id)).rejects.toThrow('injected_failure'); }
    finally { await fixture.db.prepare('DROP TRIGGER test_credit_failure').run(); }
    expect(await ledger()).toEqual([]);
    expect(await fixture.db.prepare('SELECT status FROM duty_ops_swap_requests WHERE id = ?').bind(r.id).first('status')).toBe('OPEN');
    expect(await fixture.db.prepare('SELECT user_id FROM duty_ops_effective_assignments WHERE shift_id = ?').bind(r.shiftId).first('user_id')).toBe(alice.id);
    expect(await fixture.db.prepare('SELECT COUNT(*) n FROM duty_ops_swap_reservations WHERE request_id = ?').bind(r.id).first('n')).toBe(1);
    await claimGiveAway(fixture.db, bob, r.id); expect(await ledger()).toHaveLength(2);
  });
  it('leaves direct swaps, withdrawal and cancellation available at -2 without transfers', async () => {
    const openGive = await give(); await debt(2); await cancelExchange(fixture.db, alice, openGive.id);
    const a = await shift(alice), b = await shift(bob);
    const r = await createExchange(fixture.db, alice, a, 'DIRECT_SWAP', times);
    const first = await createProposal(fixture.db, bob, r.id, b, times); await withdrawProposal(fixture.db, bob, r.id, first.id);
    const next = await createProposal(fixture.db, bob, r.id, b, times); await acceptProposal(fixture.db, alice, r.id, next.id);
    expect(await ledger()).toHaveLength(4); expect((await creditSummary(fixture.db, alice)).balance).toBe(-2);
  });
  it('keeps Flyvask exchanges independent, even when Duty Ops is at its floor', async () => {
    await debt(2); const id = crypto.randomUUID();
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO flyvask_shifts VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, NULL, ?)').bind(id, id, times.startsAt, times.endsAt, 'OPEN', now),
      fixture.db.prepare('INSERT INTO flyvask_assignments VALUES (?, ?, ?)').bind(id, alice.id, now),
    ]);
    const other = crypto.randomUUID();
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO flyvask_shifts VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, NULL, ?)').bind(other, other, times.startsAt, times.endsAt, 'OPEN', now),
      fixture.db.prepare('INSERT INTO flyvask_assignments VALUES (?, ?, ?)').bind(other, bob.id, now),
    ]);
    const r = await createFlyvask(fixture.db, alice, id, times);
    const p = await proposeFlyvask(fixture.db, bob, r.id, other, times); await acceptFlyvask(fixture.db, alice, r.id, p.id);
    expect(await ledger()).toHaveLength(4);
  });
});

describe('backfill, privacy, standings and keyset history', () => {
  it('backfills pre-migration accepted give-aways and reconciles old-code acceptances after migration idempotently', async () => {
    const old = await createTestDatabase(true, '0007_flyvask.sql');
    try {
      const owner = await seedCredential(old.db, 'old-owner'), recipient = await seedCredential(old.db, 'old-recipient', 'test', 'other@test', 'other-fl');
      for (let i = 0; i < 3; i++) await legacy(old.db, owner, recipient, `2026-09-2${i + 1}T08:00:00.000Z`);
      await old.db.prepare(`INSERT INTO duty_ops_swap_requests (id, requester_user_id, requested_starts_at, requested_ends_at, type, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'DIRECT_SWAP', 'OPEN', ?, ?), (?, ?, ?, ?, 'GIVE_AWAY', 'CANCELLED', ?, ?)`)
        .bind(crypto.randomUUID(), owner.id, times.startsAt, times.endsAt, now, now, crypto.randomUUID(), owner.id, times.startsAt, times.endsAt, now, now).run();
      await applyTestMigration(old.db, '0008_duty_ops_credits.sql');
      expect((await creditSummary(old.db, owner)).balance).toBe(-3);
      // Represents unchanged v2 code deployed while the additive migration is applied.
      await legacy(old.db, owner, recipient); await reconcileCoverage(old.db); await reconcileCoverage(old.db);
      expect((await creditSummary(old.db, owner)).balance).toBe(-4);
      expect(await old.db.prepare('SELECT COUNT(*) n FROM duty_ops_credit_transactions').first('n')).toBe(8);
      expect(await old.db.prepare('SELECT SUM(amount) n FROM duty_ops_credit_transactions').first('n')).toBe(0);
      expect(await old.db.prepare('SELECT COUNT(*) n FROM duty_ops_credit_transactions t JOIN duty_ops_swap_requests r ON r.id=t.exchange_request_id WHERE t.created_at<>r.accepted_at').first('n')).toBe(0);
    } finally { await old.dispose(); }
  });
  it('uses one trusted identity balance for aliases and deduplicates the student roster without email matching', async () => {
    await debt(2);
    const alias = await seedCredential(fixture.db, 'alias', 'test', 'alias@test', 'fl-alice');
    await fixture.db.prepare("INSERT INTO user_permission_overrides VALUES (?, 'duty_ops.swap', 'ALLOW', ?, ?, NULL)").bind(alias.id, now, now).run();
    expect((await creditSummary(fixture.db, alias)).balance).toBe(-2);
    await expect(createExchange(fixture.db, alias, await shift(alias), 'GIVE_AWAY', times)).rejects.toMatchObject({ code: 'DUTY_OPS_CREDIT_FLOOR' });
    expect((await listCredits(fixture.db, alias, null)).entries).toEqual([]);
    expect((await creditStandings(fixture.db)).students).toHaveLength(3);
  });
  it('shows only personal entries in stable 30-item pages, even when shift bookings are removed', async () => {
    for (let i = 0; i < 35; i++) await legacy(fixture.db, alice, bob);
    await legacy(fixture.db, carl, bob);
    const first = await listCredits(fixture.db, alice, null), next = await listCredits(fixture.db, alice, first.nextCursor);
    expect(first.entries).toHaveLength(30); expect(next.entries).toHaveLength(5); expect(next.nextCursor).toBeNull();
    expect(new Set([...first.entries, ...next.entries].map(e => e.id)).size).toBe(35);
    expect(first.entries.every(e => e.counterparty.id === bob.id && e.shift.id === null && e.shift.startsAt === times.startsAt)).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/private-|secret-|fl-alice|access_subject|email|ciphertext/);
    expect((await listCredits(fixture.db, carl, null)).entries).toHaveLength(1);
    await expect(listCredits(fixture.db, alice, 'broken')).rejects.toMatchObject({ status: 400 });
    const r = await give(carl); await claimGiveAway(fixture.db, bob, r.id);
    await fixture.db.prepare('DELETE FROM duty_ops_shifts WHERE id = ?').bind(r.shiftId).run();
    expect((await listCredits(fixture.db, carl, null)).entries.find(e => e.exchangeRequestId === r.id)?.shift).toEqual({ id: null, ...times });
  });
  it('sorts contributors by net balance and covered count, roster alphabetically and omits nonstudents and private fields', async () => {
    await legacy(fixture.db, alice, bob); await legacy(fixture.db, bob, alice);
    await fixture.db.prepare('UPDATE users SET flightlogger_first_name=NULL, flightlogger_last_name=NULL WHERE id=?').bind(carl.id).run();
    const nonstudent = await seedCredential(fixture.db, 'nonstudent');
    await fixture.db.prepare('DELETE FROM user_roles WHERE user_id=?').bind(nonstudent.id).run();
    const roster = await creditStandings(fixture.db);
    expect(roster.topContributors.map(r => r.student.id)).toEqual([alice.id, bob.id, carl.id]);
    expect(roster.students.map(r => r.student.id)).toEqual([alice.id, bob.id, carl.id]);
    expect(JSON.stringify(roster)).not.toMatch(/email|private-|secret-|access_subject|transaction|request|fl-alice/);
  });
  it('protects personal credits and gates full standings by manage_schedule', async () => {
    for (const standings of [false, true]) {
      expect((await api('', null, standings)).status).toBe(401);
      expect((await api('', alice, standings)).status).toBe(standings ? 403 : 200);
      expect((await api('', alice, standings, 'POST')).status).toBe(405);
    }
    await fixture.db.prepare("INSERT INTO user_permission_overrides VALUES (?, 'duty_ops.manage_schedule', 'ALLOW', ?, ?, NULL)").bind(alice.id, now, now).run();
    expect((await api('', alice, true)).status).toBe(200);
    expect((await api('?userId=other', alice, true)).status).toBe(400);
    expect((await api('?userId=other', alice)).status).toBe(400);
    expect((await api('?summary=1')).status).toBe(200);
    for (const query of ['?summary=0', '?summary=1&cursor=a', '?cursor=a&cursor=b', '?cursor=broken']) expect((await api(query)).status).toBe(400);
    await fixture.db.prepare("INSERT INTO user_permission_overrides VALUES (?, 'duty_ops.view', 'DENY', ?, ?, NULL)").bind(alice.id, now, now).run();
    expect((await api()).status).toBe(403); expect((await api('', alice, true)).status).toBe(200);
  });
});
