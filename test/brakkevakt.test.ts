import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestMigration, createTestDatabase } from './d1-fixture';
import { resolveApplicationUser, type ApplicationUser } from '../backend/users';
import { listRoster, listSchedule, removeWeek, saveWeek } from '../backend/brakkevakt/schedule';
import { acceptSwap, cancelSwap, createSwap, listSwapHistory, listSwaps, proposeSwap, withdrawSwap } from '../backend/brakkevakt/swaps';
import { currentWeekStart, osloDay, plusDays, requireWeek, weekActive } from '../backend/brakkevakt/week';
import { rosterEndpoint, scheduleEndpoint, swapEndpoint, weekEndpoint } from '../backend/brakkevakt/api';
import { testEncryptionKey } from './d1-fixture';

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let alice: ApplicationUser, bob: ApplicationUser, carl: ApplicationUser, dana: ApplicationUser;
const monday = '2026-10-05', next = '2026-10-12';
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T08:00:00.000Z'));
  fixture = await createTestDatabase();
  const users = [];
  for (const name of ['alice', 'bob', 'carl', 'dana']) {
    const user = await resolveApplicationUser(fixture.db, { subject: name, email: `${name}@private.test` });
    await fixture.db.prepare('UPDATE users SET flightlogger_first_name=?, flightlogger_last_name=?, flightlogger_user_id=? WHERE id=?')
      .bind(name, 'Student', `fl-${name}`, user.id).run();
    users.push({ ...user, flightlogger_first_name: name, flightlogger_last_name: 'Student', flightlogger_user_id: `fl-${name}` });
  }
  [alice, bob, carl, dana] = users;
  await fixture.db.prepare("INSERT INTO user_permission_overrides VALUES (?, 'brakkevakt.manage_schedule', 'ALLOW', ?, ?, NULL)")
    .bind(alice.id, 'test', 'test').run();
});
afterEach(async () => { vi.useRealTimers(); await fixture.dispose(); });
const roster = () => listRoster(fixture.db);
const save = (week: string, ids: [ApplicationUser, ApplicationUser], revision: number | null = null, actor = alice) =>
  saveWeek(fixture.db, actor, week, { userIds: [ids[0].id, ids[1].id], revision });
async function twoWeeks() {
  await save(monday, [alice, bob]); await save(next, [carl, dana]);
  const weeks = (await listSchedule(fixture.db, alice)).weeks;
  return { first: weeks[0], second: weeks[1] };
}
async function row(table: string, id: string) { return fixture.db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first<any>(); }
async function count(table: string) { return fixture.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>('n'); }
async function api(handler: (context: never) => Promise<Response> | Response, actor: ApplicationUser | null, path: string, method = 'GET', input?: unknown, headers: Record<string, string> = {}) {
  const request = new Request(`https://portal.example.test${path}`, { method,
    headers: { ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  return handler({ request, env: { DB: fixture.db, FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY: testEncryptionKey },
    data: actor ? { accessIdentity: { subject: actor.access_subject, email: actor.email } } : {},
    params: { weekStart: monday } } as never);
}

describe('Brakkevakt migration and Oslo calendar', () => {
  it.each(['0008_duty_ops_credits.sql', '0009_flights_fuel.sql'])('applies after populated %s without altering existing records', async through => {
    const earlier = await createTestDatabase(true, through);
    try {
      const existing = await resolveApplicationUser(earlier.db, { subject: 'before-brakkevakt', email: 'existing@private.test' });
      await earlier.db.prepare("UPDATE users SET flightlogger_first_name = 'Existing' WHERE id = ?").bind(existing.id).run();
      if (through.startsWith('0009')) {
        await earlier.db.prepare(`INSERT INTO flights (id, flightlogger_booking_id, booking_type, starts_at, ends_at, status, last_synced_at)
          VALUES ('fixture-flight', 'fl-booking', 'SingleStudentBooking', '2026-10-05T08:00:00Z', '2026-10-05T09:00:00Z', 'OPEN', '2026-09-28T08:00:00Z')`).run();
        await earlier.db.prepare("INSERT INTO flight_students VALUES ('fixture-flight', ?, '2026-09-28T08:00:00Z')").bind(existing.id).run();
      }
      const before = await earlier.db.prepare('SELECT * FROM users WHERE id = ?').bind(existing.id).first();
      await applyTestMigration(earlier.db, '0010_brakkevakt.sql');
      expect(await earlier.db.prepare('SELECT * FROM users WHERE id = ?').bind(existing.id).first()).toEqual(before);
      expect(await earlier.db.prepare('SELECT COUNT(*) n FROM duty_ops_credit_transactions').first<number>('n')).toBe(0);
      if (through.startsWith('0009')) expect(await earlier.db.prepare("SELECT user_id FROM flight_students WHERE flight_id = 'fixture-flight'").first('user_id')).toBe(existing.id);
      expect((await earlier.db.prepare("SELECT permission_key FROM effective_user_permissions WHERE user_id=? AND permission_key LIKE 'brakkevakt.%'")
        .bind(existing.id).all<{ permission_key: string }>()).results.map(r => r.permission_key).sort()).toEqual(['brakkevakt.swap', 'brakkevakt.view']);
    } finally { await earlier.dispose(); }
  });
  it('adds independent permissions and allows STUDENT swap but only manager schedule writes', async () => {
    const permissions = (await fixture.db.prepare("SELECT permission_key FROM effective_user_permissions WHERE user_id=? AND permission_key LIKE 'brakkevakt.%'").bind(bob.id).all<{permission_key:string}>()).results;
    expect(permissions.map(r => r.permission_key).sort()).toEqual(['brakkevakt.swap', 'brakkevakt.view']);
    await expect(save(monday, [bob, carl], null, bob)).rejects.toMatchObject({ status: 409 });
    expect((await roster()).students).toHaveLength(4);
    await save(monday, [alice, bob]); expect((await listSchedule(fixture.db, bob)).weeks).toHaveLength(1);
    expect(await count('duty_ops_credit_transactions')).toBe(0);
  });
  it('enforces Monday, unique week, two published slots and distinct users in D1', async () => {
    await expect(save('2026-10-06', [alice, bob])).rejects.toMatchObject({ status: 400 });
    await expect(save(monday, [alice, alice])).rejects.toMatchObject({ status: 400 });
    await save(monday, [alice, bob]);
    await expect(save(monday, [alice, bob], null)).rejects.toMatchObject({ status: 409 });
    await expect(fixture.db.prepare('DELETE FROM brakkevakt_assignments WHERE user_id=?').bind(alice.id).run()).rejects.toThrow('brakkevakt_two_required');
    await expect(fixture.db.prepare("INSERT INTO brakkevakt_periods (id,week_start,published,created_at,updated_at) VALUES (?, '2026-10-19', 1, 't', 't')")
      .bind(crypto.randomUUID()).run()).rejects.toThrow('brakkevakt_two_required');
    expect((await listSchedule(fixture.db, alice)).weeks[0].assignments).toHaveLength(2);
  });
  it('uses Oslo local Mondays and calendar arithmetic across year and both DST changes', () => {
    expect(currentWeekStart(new Date('2026-09-27T22:30:00Z'))).toBe('2026-09-28');
    expect(currentWeekStart(new Date('2027-01-03T23:30:00Z'))).toBe('2027-01-04');
    expect(plusDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(requireWeek('2026-03-23')).toBe('2026-03-23');
    expect(requireWeek('2026-10-19')).toBe('2026-10-19');
    const spring = Date.parse('2026-03-30T00:00:00+02:00') - Date.parse('2026-03-23T00:00:00+01:00');
    const autumn = Date.parse('2026-10-26T00:00:00+01:00') - Date.parse('2026-10-19T00:00:00+02:00');
    expect(spring / 3600000).toBe(167); expect(autumn / 3600000).toBe(169);
    expect(weekActive('2026-09-28')).toBe(true); expect(osloDay()).toBe('2026-09-28');
  });
});

describe('canonical schedule and direct swaps', () => {
  it('saves two named users, edits stable slots, audits, and rejects stale revisions or nonstudents', async () => {
    const made = await save(monday, [alice, bob]);
    expect((await listSchedule(fixture.db, carl)).weeks[0].assignments.map(a => a.user.firstName)).toEqual(['alice', 'bob']);
    const before = (await listSchedule(fixture.db, alice)).weeks[0].assignments;
    await save(monday, [alice, carl], made.revision);
    const after = (await listSchedule(fixture.db, alice)).weeks[0].assignments;
    expect(after[0].id).toBe(before[0].id); expect(after[1].id).toBe(before[1].id);
    expect(after.map(a => a.user.id)).toEqual([alice.id, carl.id]);
    await expect(save(monday, [alice, dana], made.revision)).rejects.toMatchObject({ status: 409 });
    await fixture.db.prepare('DELETE FROM user_roles WHERE user_id=?').bind(dana.id).run();
    await expect(save(next, [alice, dana])).rejects.toMatchObject({ status: 400 });
    expect(await count('brakkevakt_schedule_events')).toBe(4);
    expect(JSON.stringify(await listSchedule(fixture.db, bob))).not.toMatch(/private\.test|access_subject|flightlogger_user_id/);
  });
  it('supports direct acceptance, preserves unaffected partners, then immediately re-swaps a received slot', async () => {
    const { first, second } = await twoWeeks();
    const r = await createSwap(fixture.db, alice, first.assignments[0].id);
    const p = await proposeSwap(fixture.db, carl, r.id, second.assignments[0].id);
    await acceptSwap(fixture.db, alice, r.id, p.id);
    let weeks = (await listSchedule(fixture.db, alice)).weeks;
    expect(weeks[0].assignments.map(a => a.user.id)).toEqual([carl.id, bob.id]);
    expect(weeks[1].assignments.map(a => a.user.id)).toEqual([alice.id, dana.id]);
    expect((await listSwapHistory(fixture.db, alice, null)).entries[0]).toMatchObject({ givenWeekStart: monday, receivedWeekStart: next, counterparty: { id: carl.id } });
    const received = weeks[1].assignments[0];
    const r2 = await createSwap(fixture.db, alice, received.id);
    const p2 = await proposeSwap(fixture.db, bob, r2.id, weeks[0].assignments[1].id);
    await acceptSwap(fixture.db, alice, r2.id, p2.id);
    weeks = (await listSchedule(fixture.db, alice)).weeks;
    expect(weeks[0].assignments.map(a => a.user.id)).toEqual([carl.id, alice.id]);
    expect(weeks[1].assignments.map(a => a.user.id)).toEqual([bob.id, dana.id]);
    expect(await count('duty_ops_credit_transactions')).toBe(0);
  });
  it('rejects a swap that would duplicate a team member and keeps both weeks intact', async () => {
    await save(monday, [alice, bob]); await save(next, [alice, carl]);
    const weeks = (await listSchedule(fixture.db, alice)).weeks;
    const request = await createSwap(fixture.db, alice, weeks[1].assignments[0].id);
    const proposal = await proposeSwap(fixture.db, bob, request.id, weeks[0].assignments[1].id);
    await expect(acceptSwap(fixture.db, alice, request.id, proposal.id)).rejects.toMatchObject({ status: 409 });
    expect((await listSchedule(fixture.db, alice)).weeks.map(w => w.assignments.map(a => a.user.id))).toEqual([[alice.id, bob.id], [alice.id, carl.id]]);
  });
  it('releases locks on withdrawal/cancellation and invalidates owner-changed intent on a manager edit', async () => {
    const { first, second } = await twoWeeks();
    const r = await createSwap(fixture.db, alice, first.assignments[0].id);
    const p = await proposeSwap(fixture.db, carl, r.id, second.assignments[0].id);
    await withdrawSwap(fixture.db, carl, r.id, p.id);
    const p2 = await proposeSwap(fixture.db, carl, r.id, second.assignments[0].id);
    await save(next, [bob, dana], second.revision);
    expect((await row('brakkevakt_swap_proposals', p2.id)).status).toBe('INVALIDATED');
    expect((await row('brakkevakt_swap_requests', r.id)).status).toBe('OPEN');
    await expect(acceptSwap(fixture.db, alice, r.id, p2.id)).rejects.toMatchObject({ status: 409 });
    await save(monday, [bob, dana], first.revision);
    expect((await row('brakkevakt_swap_requests', r.id)).status).toBe('INVALIDATED');
    expect(await count('brakkevakt_swap_reservations')).toBe(0);
    expect((await fixture.db.prepare("SELECT COUNT(*) n FROM brakkevakt_swap_events WHERE type LIKE '%INVALIDATED'").first<number>('n'))).toBeGreaterThanOrEqual(2);
  });
  it('removes only future weeks and preserves schedule audit', async () => {
    const made = await save(monday, [alice, bob]);
    await removeWeek(fixture.db, alice, monday, made.revision);
    expect((await listSchedule(fixture.db, alice)).weeks).toEqual([]);
    expect(await count('brakkevakt_schedule_events')).toBe(4);
    await save('2026-09-28', [alice, bob]);
    await expect(removeWeek(fixture.db, alice, '2026-09-28', 1)).rejects.toMatchObject({ status: 409 });
  });
  it('keeps multiple proposals open until one is accepted, then closes alternatives and reservations', async () => {
    const { first, second } = await twoWeeks();
    const request = await createSwap(fixture.db, alice, first.assignments[0].id);
    const chosen = await proposeSwap(fixture.db, carl, request.id, second.assignments[0].id);
    const other = await proposeSwap(fixture.db, dana, request.id, second.assignments[1].id);
    await expect(createSwap(fixture.db, bob, first.assignments[0].id)).rejects.toMatchObject({ status: 409 });
    await expect(acceptSwap(fixture.db, bob, request.id, chosen.id)).rejects.toMatchObject({ status: 409 });
    await acceptSwap(fixture.db, alice, request.id, chosen.id);
    expect((await row('brakkevakt_swap_proposals', chosen.id)).status).toBe('ACCEPTED');
    expect((await row('brakkevakt_swap_proposals', other.id)).status).toBe('NOT_SELECTED');
    expect(await count('brakkevakt_swap_reservations')).toBe(0);
    await expect(acceptSwap(fixture.db, alice, request.id, other.id)).rejects.toMatchObject({ status: 409 });
    expect((await listSwapHistory(fixture.db, bob, null)).entries).toEqual([]);
    expect((await listSwapHistory(fixture.db, dana, null)).entries).toEqual([]);
    expect(JSON.stringify(await listSwapHistory(fixture.db, alice, null))).not.toMatch(/private\.test|access_subject|flightlogger_user_id/);
  });
  it('allows current-week intent, blocks ended weeks and cancellations by nonowners', async () => {
    const current = await save('2026-09-28', [alice, bob]);
    const future = await save(monday, [carl, dana]);
    const schedule = (await listSchedule(fixture.db, alice)).weeks;
    const request = await createSwap(fixture.db, alice, schedule[0].assignments[0].id);
    await expect(cancelSwap(fixture.db, carl, request.id)).rejects.toMatchObject({ status: 409 });
    await cancelSwap(fixture.db, alice, request.id);
    expect(await count('brakkevakt_swap_reservations')).toBe(0);
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
    await expect(createSwap(fixture.db, alice, schedule[0].assignments[0].id)).rejects.toMatchObject({ status: 409 });
    await expect(save('2026-09-28', [alice, carl], current.revision)).rejects.toMatchObject({ status: 409 });
    expect(future.revision).toBe(1);
  });
  it('guards every route, strict mutation body and same-origin writes without an onboarding credential', async () => {
    expect((await api(scheduleEndpoint, null, '/api/brakkevakt')).status).toBe(401);
    expect((await api(rosterEndpoint, bob, '/api/brakkevakt/roster')).status).toBe(403);
    expect((await api(scheduleEndpoint, bob, '/api/brakkevakt')).status).toBe(200);
    expect((await api(weekEndpoint, bob, `/api/brakkevakt/schedule/${monday}`, 'PUT', { userIds: [bob.id, carl.id], revision: null })).status).toBe(403);
    expect((await api(weekEndpoint, alice, `/api/brakkevakt/schedule/${monday}`, 'PUT', { userIds: [alice.id, bob.id], revision: null, actor: alice.id })).status).toBe(400);
    expect((await api(weekEndpoint, alice, `/api/brakkevakt/schedule/${monday}`, 'PUT', { userIds: [alice.id, bob.id], revision: null }, { Origin: 'https://attacker.test' })).status).toBe(403);
    const saved = await api(weekEndpoint, alice, `/api/brakkevakt/schedule/${monday}`, 'PUT', { userIds: [alice.id, bob.id], revision: null });
    expect(saved.status, await saved.text()).toBe(200);
    await fixture.db.prepare("INSERT INTO user_permission_overrides VALUES (?, 'brakkevakt.swap', 'DENY', 'test', 'test', NULL)").bind(alice.id).run();
    const assignment = (await listSchedule(fixture.db, alice)).weeks[0].assignments[0].id;
    expect((await api(context => swapEndpoint(context, 'requests'), alice, '/api/brakkevakt/swaps', 'POST', { assignmentId: assignment })).status).toBe(403);
    await fixture.db.prepare("INSERT INTO user_permission_overrides VALUES (?, 'brakkevakt.view', 'DENY', 'test', 'test', NULL)").bind(bob.id).run();
    expect((await api(scheduleEndpoint, bob, '/api/brakkevakt')).status).toBe(403);
    await fixture.db.prepare("DELETE FROM user_permission_overrides WHERE user_id = ? AND permission_key = 'brakkevakt.view'").bind(bob.id).run();
    expect((await api(scheduleEndpoint, bob, '/api/brakkevakt')).status).toBe(200);
    await fixture.db.prepare("DELETE FROM user_permission_overrides WHERE user_id = ? AND permission_key = 'brakkevakt.manage_schedule'").bind(alice.id).run();
    expect((await api(weekEndpoint, alice, `/api/brakkevakt/schedule/${next}`, 'PUT', { userIds: [alice.id, bob.id], revision: null })).status).toBe(403);
  });
});
