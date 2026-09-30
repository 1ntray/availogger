import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FlightLoggerClient } from '../backend/flightlogger/client';
import { parseFlyvaskMeeting } from '../backend/flightlogger/flyvask';
import { flyvaskWindow } from '../backend/flyvask/window';
import { FLYVASK_TTL_MS, loadFlyvask, saveAssignments, saveDiscovery } from '../backend/flyvask/service';
import { storeFlightLoggerCredential } from '../backend/flightlogger-credentials';
import { createTestDatabase, seedCredential, testEncryptionKey } from './d1-fixture';
import type { ApplicationUser } from '../backend/users';

const now = new Date('2026-09-27T12:00:00Z');
const window = flyvaskWindow(new URL('https://test/api/flyvask'), now);
const raw = (id = 'booking-1', participants: unknown[] = [null, null, null]) => ({ __typename: 'MeetingBooking', id,
  startsAt: '2026-09-28T05:00:00Z', endsAt: '2026-09-28T12:00:00Z', status: 'OPEN', comment: 'FLYVASK', externalReference: null,
  classroom: { id: '602', name: 'Hangar UTSA' }, participants });
const profile = { id: 'fl-student', firstName: 'Simon', lastName: 'Student' };
const page = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null) => Response.json({ data: { bookings: { nodes, pageInfo: { hasNextPage, endCursor } } } });
let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let user: ApplicationUser;
let own: unknown[];
let shared: unknown[];
let upstream: ReturnType<typeof vi.fn>;

beforeAll(async () => { fixture = await createTestDatabase(); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  await fixture.db.prepare('DELETE FROM users').run();
  await fixture.db.prepare('DELETE FROM flyvask_shifts').run();
  await fixture.db.prepare('DELETE FROM flyvask_sync_state').run();
  user = await seedCredential(fixture.db);
  own = [raw('booking-1', [null, { id: profile.id, firstName: 'Test', lastName: 'Student' }, null])];
  shared = [raw()];
  upstream = vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (body.query.includes('CurrentUserProfile')) return Response.json({ data: { user: profile } });
    return page(body.variables.all ? shared : own);
  });
  vi.stubGlobal('fetch', upstream);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(async () => { await fixture.dispose(); });

describe('Flyvask parsing and bounded pagination', () => {
  it('identifies normalized comments, never the room, and discards identities', () => {
    const meeting = parseFlyvaskMeeting(raw('abc', [null, { id: 'someone', firstName: 'Private', lastName: 'Name' }, null]))!;
    expect(meeting.participantCount).toBe(3);
    expect(JSON.stringify(meeting)).not.toMatch(/someone|Private|"Name"/);
    expect(parseFlyvaskMeeting({ ...raw(), classroom: { id: '900', name: 'Other room' } })).not.toBeNull();
    expect(parseFlyvaskMeeting({ ...raw(), comment: ' flyvask ' })).not.toBeNull();
    expect(parseFlyvaskMeeting({ ...raw(), comment: 'OTHER' })).toBeNull();
    expect(parseFlyvaskMeeting({ ...raw(), comment: null })).toBeNull();
    expect(parseFlyvaskMeeting({ __typename: 'MaintenanceBooking' })).toBeNull();
    expect(parseFlyvaskMeeting({ ...raw(), classroom: null })).toMatchObject({ classroomId: null, classroomName: null });
    expect(parseFlyvaskMeeting({ ...raw(), classroom: { id: '602', name: 'Renamed' } })).not.toBeNull();
    expect(parseFlyvaskMeeting({ __typename: 'OperationBooking' })).toBeNull();
  });
  it.each([
    { id: '' }, { startsAt: '2026-02-30T05:00:00Z' }, { endsAt: '2026-09-28T04:00:00Z' },
    { startsAt: '2026-09-28T07:00:00+02:00' }, { participants: null }, { participants: [{}] },
    { classroom: {} }, { comment: undefined }, { comment: 'x'.repeat(4097) }, { status: 'invented' }, { externalReference: 3 },
  ])('fails safely for malformed records %#', changes => expect(() => parseFlyvaskMeeting({ ...raw(), ...changes })).toThrow());
  it('reads more than 50 records in both modes and filters server-side', async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const { variables } = JSON.parse(init!.body as string);
      expect(variables.from).toBe(window.startsAt); expect(variables.to).toBe(window.endsAt);
      return variables.after ? page([raw('last'), { ...raw('other'), comment: 'OTHER' }])
        : page(Array.from({ length: 50 }, (_, i) => raw(`b${i}`)), true, 'next');
    });
    const client = new FlightLoggerClient('pagination-key', fetcher);
    for (const all of [true, false]) expect(await client.flyvask(window.startsAt, window.endsAt, all)).toHaveLength(51);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).query).toContain('overlap: true');
  });
  it('rejects cursor cycles, malformed pagination, conflicting duplicates and bounded exhaustion', async () => {
    const cycle = vi.fn().mockResolvedValueOnce(page([raw()], true, 'a')).mockResolvedValueOnce(page([raw()], true, 'b')).mockResolvedValue(page([raw()], true, 'a'));
    await expect(new FlightLoggerClient('cycle', cycle).flyvask(window.startsAt, window.endsAt, true)).rejects.toThrow('progress');
    const bad = vi.fn(async () => Response.json({ data: { bookings: { nodes: [], pageInfo: {} } } }));
    await expect(new FlightLoggerClient('bad', bad).flyvask(window.startsAt, window.endsAt, true)).rejects.toThrow('pagination');
    const conflict = vi.fn(async () => page([raw(), { ...raw(), endsAt: '2026-09-28T13:00:00Z' }]));
    await expect(new FlightLoggerClient('conflict', conflict).flyvask(window.startsAt, window.endsAt, true)).rejects.toThrow('conflicting');
    let n = 0;
    const endless = vi.fn(async () => page([raw(`b${n}`)], true, `cursor${++n}`));
    await expect(new FlightLoggerClient('endless', endless, 3).flyvask(window.startsAt, window.endsAt, true)).rejects.toThrow('Too many');
    expect(endless).toHaveBeenCalledTimes(3);
  });
});

describe('Flyvask windows', () => {
  it('uses 30 past and 60 future Oslo dates and DST-aware half-open boundaries', () => {
    expect(window).toMatchObject({ from: '2026-08-28', to: '2026-11-26' });
    for (const [date, hours] of [['2026-03-29', 23], ['2026-10-25', 25]] as const) {
      const w = flyvaskWindow(new URL(`https://test/api/flyvask?from=${date}&to=${date}`));
      expect((Date.parse(w.endsAt) - Date.parse(w.startsAt)) / 3600000).toBe(hours);
    }
  });
  it.each(['?from=2026-01-01', '?from=2026-02-30&to=2026-03-01', '?from=2026-01-01&to=2026-05-01', '?from=2026-10-01&to=2026-09-01', '?user_id=other', '?from=2026-09-01&from=2026-09-02&to=2026-09-03'])('rejects invalid/identity-selecting range %s', suffix => expect(() => flyvaskWindow(new URL(`https://test/api/flyvask${suffix}`))).toThrow());
});

describe('D1 synchronization and identity aggregation', () => {
  it('bulk upserts more than 100 shifts without per-row SQL or duplicate IDs', async () => {
    const meetings = Array.from({ length: 120 }, (_, i) => parseFlyvaskMeeting(raw(`bulk-${i}`))!);
    await saveDiscovery(fixture.db, meetings, window, now.toISOString());
    await saveAssignments(fixture.db, user, profile, meetings, window, now.toISOString(), 'hash');
    await saveDiscovery(fixture.db, meetings.map(m => ({ ...m, participantCount: 4 })), window, now.toISOString());
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_shifts WHERE participant_count = 4').first('n')).toBe(120);
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_assignments').first('n')).toBe(120);
  });
  it('rolls an assignment sync back atomically if a later database write fails', async () => {
    await fixture.db.prepare(`CREATE TRIGGER reject_duty_profile BEFORE UPDATE ON users
      WHEN NEW.flightlogger_first_name = 'Reject' BEGIN SELECT RAISE(ABORT, 'test rejection'); END`).run();
    try {
      await expect(saveAssignments(fixture.db, user, { ...profile, firstName: 'Reject' }, [parseFlyvaskMeeting(raw())!], window, now.toISOString(), 'hash')).rejects.toThrow();
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_shifts').first('n')).toBe(0);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_assignments').first('n')).toBe(0);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_sync_state').first('n')).toBe(0);
    } finally { await fixture.db.prepare('DROP TRIGGER reject_duty_profile').run(); }
  });
  it('hydrates trusted self names, stable shift IDs, masked counts and separate freshness', async () => {
    const first = await loadFlyvask(fixture.db, user, 'test-token', window);
    expect(first.shifts).toHaveLength(1);
    expect(first.shifts[0]).toMatchObject({ startsAt: '2026-09-28T05:00:00.000Z', participantCount: 3,
      participants: [{ userId: user.id, firstName: 'Simon', lastName: 'Student', isCurrentUser: true }] });
    expect(first.sync.stale).toBe(false);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(await loadFlyvask(fixture.db, user, 'test-token', window)).toEqual(first);
    expect(upstream).toHaveBeenCalledTimes(3);
    const anna = await seedCredential(fixture.db, 'anna', 'anna-key', 'anna@test', 'fl-anna');
    upstream.mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body as string);
      return body.query.includes('CurrentUserProfile') ? Response.json({ data: { user: { id: 'fl-anna', firstName: 'Anna', lastName: null } } }) : page([raw()]);
    });
    const second = await loadFlyvask(fixture.db, anna, 'anna-key', window);
    expect(second.shifts[0].id).toBe(first.shifts[0].id);
    expect(second.shifts[0].participants).toHaveLength(2);
    expect(second.shifts[0].participants.filter(p => p.isCurrentUser).map(p => p.firstName)).toEqual(['Anna']);
    expect(upstream).toHaveBeenCalledTimes(5); // no repeat discovery for second user
    expect(JSON.stringify(second)).not.toMatch(/test-token|anna-key|token_hash|ciphertext|access_subject|@test|fl-anna/);
  });
  it('uses all:false association even if every participant is masked; never learns other names', async () => {
    shared = [raw('booking-1', [{ id: 'fl-other', firstName: 'Forbidden', lastName: 'Other' }, null])];
    own = [raw('booking-1', [null, null])];
    const result = await loadFlyvask(fixture.db, user, 'test-token', window);
    expect(result.shifts[0].participants).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('Forbidden');
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(1);
  });
  it('refreshes discovery and personal assignments independently at five minutes', async () => {
    await loadFlyvask(fixture.db, user, 'test-token', window);
    const twoMinutes = new Date(now.getTime() + 120000).toISOString();
    await saveAssignments(fixture.db, user, profile, [parseFlyvaskMeeting(raw())!], window, twoMinutes,
      (await fixture.db.prepare('SELECT token_hash FROM flyvask_sync_state WHERE user_id = ?').bind(user.id).first<string>('token_hash'))!);
    vi.setSystemTime(new Date(now.getTime() + FLYVASK_TTL_MS));
    const atFive = await loadFlyvask(fixture.db, user, 'test-token', window);
    expect(upstream).toHaveBeenCalledTimes(4); // discovery only
    expect(atFive.sync.assignments.lastSyncedAt).toBe(twoMinutes);
    vi.setSystemTime(new Date(now.getTime() + FLYVASK_TTL_MS + 120000));
    await loadFlyvask(fixture.db, user, 'test-token', window);
    expect(upstream).toHaveBeenCalledTimes(6); // self + assignments only
  }, 30000);
  it('does not let an older discovery delete a newer own assignment on an existing shift', async () => {
    const meetings = [parseFlyvaskMeeting(raw())!];
    await saveDiscovery(fixture.db, meetings, window, now.toISOString());
    await saveAssignments(fixture.db, user, profile, meetings, window, '2026-09-27T12:02:00.000Z', 'hash');
    await saveDiscovery(fixture.db, [], window, '2026-09-27T12:01:00.000Z');
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_assignments').first('n')).toBe(1);
  });
  it('reconciles only the current user, is idempotent, and removes shared absent shifts only in-window', async () => {
    const meetings = [parseFlyvaskMeeting(raw())!]; const stamp = now.toISOString();
    await saveDiscovery(fixture.db, meetings, window, stamp);
    const anna = await seedCredential(fixture.db, 'anna', 'anna-key', 'anna@test', 'fl-anna');
    await saveAssignments(fixture.db, user, profile, meetings, window, stamp, 'hash');
    await saveAssignments(fixture.db, anna, { id: 'fl-anna', firstName: 'Anna', lastName: null }, meetings, window, stamp, 'anna-hash');
    await saveAssignments(fixture.db, anna, { id: 'fl-anna', firstName: 'Anna', lastName: null }, meetings, window, stamp, 'anna-hash');
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_assignments').first('n')).toBe(2);
    await saveAssignments(fixture.db, user, profile, [], window, stamp, 'hash');
    expect(await fixture.db.prepare('SELECT user_id FROM flyvask_assignments').first('user_id')).toBe(anna.id);
    const outside = { ...meetings[0], id: 'outside', startsAt: '2027-01-01T06:00:00.000Z', endsAt: '2027-01-01T12:00:00.000Z' };
    const otherWindow = flyvaskWindow(new URL('https://test/api/flyvask?from=2027-01-01&to=2027-01-01'));
    await saveDiscovery(fixture.db, [outside], otherWindow, stamp);
    await saveDiscovery(fixture.db, [], window, stamp);
    expect(await fixture.db.prepare('SELECT flightlogger_booking_id FROM flyvask_shifts').first('flightlogger_booking_id')).toBe('outside');
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_assignments').first('n')).toBe(0);
  }, 30000);
  it('handles overlapping overnight boundary shifts and preserves newer writes against older refreshes', async () => {
    const w = flyvaskWindow(new URL('https://test/api/flyvask?from=2026-09-28&to=2026-09-28'));
    const meeting = { ...parseFlyvaskMeeting(raw())!, startsAt: '2026-09-27T21:00:00.000Z', endsAt: '2026-09-28T01:00:00.000Z' };
    const later = '2026-09-27T12:01:00.000Z';
    await saveDiscovery(fixture.db, [meeting], w, later);
    await saveAssignments(fixture.db, user, profile, [meeting], w, later, 'hash');
    await saveDiscovery(fixture.db, [], w, now.toISOString());
    await saveAssignments(fixture.db, user, profile, [], w, now.toISOString(), 'hash');
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_assignments').first('n')).toBe(1);
    await saveAssignments(fixture.db, user, profile, [], w, '2026-09-27T12:02:00.000Z', 'hash');
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_assignments').first('n')).toBe(0);
  });
  it('returns a stale snapshot after failed pagination/429 without deleting prior rows or marking fresh', async () => {
    const first = await loadFlyvask(fixture.db, user, 'stale-test-token', window);
    vi.setSystemTime(new Date(now.getTime() + FLYVASK_TTL_MS));
    upstream.mockResolvedValueOnce(page([raw('new')], true, 'next')).mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '20' } }));
    const stale = await loadFlyvask(fixture.db, user, 'stale-test-token', window);
    expect(stale.shifts).toEqual(first.shifts);
    expect(stale.sync).toMatchObject({ stale: true, warning: expect.stringContaining('Refresh failed'), discovery: { lastSyncedAt: now.toISOString(), stale: true } });
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_shifts').first('n')).toBe(1);
  });
  it('fails cleanly without a usable snapshot and rejects mismatched self identity', async () => {
    upstream.mockResolvedValue(new Response('private upstream details', { status: 429, headers: { 'Retry-After': '30' } }));
    await expect(loadFlyvask(fixture.db, user, 'empty-429-token', window)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 30 });
    upstream.mockImplementation(async (_url, init) => JSON.parse(init.body as string).query.includes('CurrentUserProfile')
      ? Response.json({ data: { user: { ...profile, id: 'not-self' } } }) : page(shared));
    await expect(loadFlyvask(fixture.db, user, 'different-token', window)).rejects.toMatchObject({ status: 503 });
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_assignments').first('n')).toBe(0);
  });
  it('supports authoritative empty data, avoids repeat requests, and deduplicates concurrent loads', async () => {
    own = []; shared = [];
    const results = await Promise.all([loadFlyvask(fixture.db, user, 'test-token', window), loadFlyvask(fixture.db, user, 'test-token', window)]);
    expect(results[0]).toEqual(results[1]); expect(results[0].shifts).toEqual([]);
    expect(results[0].sync.stale).toBe(false); expect(upstream).toHaveBeenCalledTimes(3);
  });
  it('invalidates own freshness on replacement and clears assignments/names on changed FlightLogger identity', async () => {
    await loadFlyvask(fixture.db, user, 'test-token', window);
    vi.setSystemTime(new Date(now.getTime() + 1000));
    upstream.mockResolvedValue(Response.json({ data: { user: { id: 'replacement-id' } } }));
    await storeFlightLoggerCredential(fixture.db, user, 'replacement-key', testEncryptionKey);
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_assignments WHERE user_id = ?').bind(user.id).first('n')).toBe(0);
    expect(await fixture.db.prepare('SELECT flightlogger_first_name FROM users WHERE id = ?').bind(user.id).first('flightlogger_first_name')).toBeNull();
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_sync_state WHERE user_id = ?').bind(user.id).first('n')).toBe(0);
    // A refresh started with the old connection cannot put it back.
    await saveAssignments(fixture.db, user, profile, [parseFlyvaskMeeting(raw())!], window, now.toISOString(), 'old-hash');
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM flyvask_assignments').first('n')).toBe(0);
  });
});
