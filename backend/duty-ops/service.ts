import { ApplicationError } from '../application-error';
import { FlightLoggerClient, FlightLoggerError } from '../flightlogger/client';
import type { DutyMeeting, FlightLoggerProfile } from '../flightlogger/duty-ops';
import type { ApplicationUser } from '../users';
import type { DutyWindow } from './window';

export const DUTY_OPS_TTL_MS = 5 * 60 * 1000;
// Reserve headroom for Access verification and D1 calls on Workers Free.
export const DUTY_OPS_MAX_REQUESTS = 30;
type SyncState = { scope: string; window_from: string; window_to: string; token_hash: string | null; last_synced_at: string };
type ShiftRow = { id: string; starts_at: string; ends_at: string; status: string; participant_count: number };
type ParticipantRow = { shift_id: string; user_id: string; flightlogger_user_id: string; flightlogger_first_name: string | null; flightlogger_last_name: string | null };
const pending = new WeakMap<D1Database, Map<string, Promise<DutyOpsResponse>>>();
export interface DutyOpsResponse {
  from: string; to: string; timeZone: 'Europe/Oslo';
  shifts: { id: string; startsAt: string; endsAt: string; status: string; participantCount: number;
    participants: { userId: string; firstName: string | null; lastName: string | null; isCurrentUser: boolean }[] }[];
  sync: { stale: boolean; warning: string | null; discovery: SyncMetadata; assignments: SyncMetadata };
}
type SyncMetadata = { lastSyncedAt: string; stale: boolean; from: string; to: string };

function covers(state: SyncState, window: DutyWindow) { return state.window_from <= window.startsAt && state.window_to >= window.endsAt; }
function fresh(state: SyncState | undefined, window: DutyWindow) {
  const age = state ? Date.now() - Date.parse(state.last_synced_at) : Infinity;
  return !!state && covers(state, window) && age >= 0 && age < DUTY_OPS_TTL_MS;
}
function usable(state: SyncState | undefined, window: DutyWindow) {
  return !!state && state.window_from < window.endsAt && state.window_to > window.startsAt;
}
async function states(db: D1Database, userId: string, hash: string) {
  const { results } = await db.prepare('SELECT * FROM duty_ops_sync_state WHERE scope IN (?, ?)').bind('global', `user:${userId}`).all<SyncState>();
  return { global: results.find(s => s.scope === 'global'), own: results.find(s => s.scope === `user:${userId}` && s.token_hash === hash) };
}
function stateWrite(db: D1Database, scope: string, window: DutyWindow, stamp: string, user: ApplicationUser | null, hash: string | null) {
  return db.prepare(`INSERT INTO duty_ops_sync_state (scope, user_id, window_from, window_to, token_hash, last_synced_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE ? IS NULL OR EXISTS (
      SELECT 1 FROM users JOIN flightlogger_credentials c ON c.user_id = users.id
      WHERE users.id = ? AND flightlogger_user_id = ? AND c.updated_at <= ?)
    ON CONFLICT(scope) DO UPDATE SET window_from = excluded.window_from, window_to = excluded.window_to,
      token_hash = excluded.token_hash, last_synced_at = excluded.last_synced_at
    WHERE duty_ops_sync_state.last_synced_at <= excluded.last_synced_at`)
    .bind(scope, user?.id ?? null, window.startsAt, window.endsAt, hash, stamp, user?.id ?? null, user?.id ?? null, user?.flightlogger_user_id ?? null, stamp);
}
function shiftWrite(db: D1Database, meetings: DutyMeeting[], stamp: string, discovery: boolean, user?: ApplicationUser) {
  // JSON bulk inserts keep query/parameter counts bounded independently of booking count.
  const rows = meetings.map(m => ({ ...m, portalId: crypto.randomUUID() }));
  const guard = discovery ? '1' : `EXISTS (SELECT 1 FROM users JOIN flightlogger_credentials c ON c.user_id = users.id
    WHERE users.id = ? AND flightlogger_user_id = ? AND c.updated_at <= ?)`;
  const statement = db.prepare(`INSERT INTO duty_ops_shifts
    (id, flightlogger_booking_id, starts_at, ends_at, status, participant_count, external_reference, last_synced_at)
    SELECT json_extract(value, '$.portalId'), json_extract(value, '$.id'), json_extract(value, '$.startsAt'),
      json_extract(value, '$.endsAt'), json_extract(value, '$.status'), json_extract(value, '$.participantCount'),
      json_extract(value, '$.externalReference'), ? FROM json_each(?) WHERE ${guard}
    ON CONFLICT(flightlogger_booking_id) ${discovery ? `DO UPDATE SET starts_at = excluded.starts_at, ends_at = excluded.ends_at,
      status = excluded.status, participant_count = excluded.participant_count, external_reference = excluded.external_reference,
      last_synced_at = excluded.last_synced_at WHERE duty_ops_shifts.last_synced_at <= excluded.last_synced_at` : 'DO NOTHING'}`);
  return discovery ? statement.bind(stamp, JSON.stringify(rows)) : statement.bind(stamp, JSON.stringify(rows), user!.id, user!.flightlogger_user_id, stamp);
}

export async function saveDiscovery(db: D1Database, meetings: DutyMeeting[], window: DutyWindow, stamp: string) {
  await db.batch([
    shiftWrite(db, meetings, stamp, true),
    db.prepare(`DELETE FROM duty_ops_shifts WHERE starts_at < ? AND ends_at > ? AND last_synced_at <= ?
      AND flightlogger_booking_id NOT IN (SELECT value FROM json_each(?))
      AND NOT EXISTS (SELECT 1 FROM duty_ops_assignments a WHERE a.shift_id = duty_ops_shifts.id AND a.last_seen_at > ?)`)
      .bind(window.endsAt, window.startsAt, stamp, JSON.stringify(meetings.map(m => m.id)), stamp),
    stateWrite(db, 'global', window, stamp, null, null),
  ]);
}

export async function saveAssignments(db: D1Database, user: ApplicationUser, profile: FlightLoggerProfile, meetings: DutyMeeting[], window: DutyWindow, stamp: string, hash: string) {
  if (profile.id !== user.flightlogger_user_id) throw new ApplicationError('Your FlightLogger identity changed. Reconnect the API key in Settings.', 409);
  const ids = JSON.stringify(meetings.map(m => m.id));
  await db.batch([
    // all:false can discover a newly created booking between global refreshes, but
    // only all:true replaces canonical metadata and removes absent shared shifts.
    shiftWrite(db, meetings, stamp, false, user),
    db.prepare(`DELETE FROM duty_ops_assignments WHERE user_id = ? AND last_seen_at <= ?
      AND shift_id IN (SELECT id FROM duty_ops_shifts WHERE starts_at < ? AND ends_at > ?
        AND flightlogger_booking_id NOT IN (SELECT value FROM json_each(?)))
      AND EXISTS (SELECT 1 FROM users JOIN flightlogger_credentials c ON c.user_id = users.id
        WHERE users.id = ? AND flightlogger_user_id = ? AND c.updated_at <= ?)`)
      .bind(user.id, stamp, window.endsAt, window.startsAt, ids, user.id, profile.id, stamp),
    db.prepare(`INSERT INTO duty_ops_assignments (shift_id, user_id, last_seen_at)
      SELECT id, ?, ? FROM duty_ops_shifts WHERE flightlogger_booking_id IN (SELECT value FROM json_each(?))
        AND EXISTS (SELECT 1 FROM users JOIN flightlogger_credentials c ON c.user_id = users.id
          WHERE users.id = ? AND flightlogger_user_id = ? AND c.updated_at <= ?)
      ON CONFLICT(shift_id, user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
      WHERE duty_ops_assignments.last_seen_at <= excluded.last_seen_at`)
      .bind(user.id, stamp, ids, user.id, profile.id, stamp),
    db.prepare(`UPDATE users SET flightlogger_first_name = ?, flightlogger_last_name = ?, updated_at = ?
      WHERE id = ? AND flightlogger_user_id = ? AND updated_at <= ? AND EXISTS (
        SELECT 1 FROM flightlogger_credentials WHERE user_id = ? AND updated_at <= ?)`)
      .bind(profile.firstName, profile.lastName, stamp, user.id, profile.id, stamp, user.id, stamp),
    stateWrite(db, `user:${user.id}`, window, stamp, user, hash),
  ]);
}

async function syncAndRead(db: D1Database, user: ApplicationUser, token: string, window: DutyWindow, hash: string): Promise<DutyOpsResponse> {
  let state = await states(db, user.id, hash);
  const client = new FlightLoggerClient(token, undefined, DUTY_OPS_MAX_REQUESTS);
  let warning: string | null = null;
  let failure: unknown;
  if (!fresh(state.global, window)) {
    const stamp = new Date().toISOString();
    try { await saveDiscovery(db, await client.dutyOps(window.startsAt, window.endsAt, true), window, stamp); }
    catch (cause) { failure = cause; }
  }
  if (!fresh(state.own, window)) {
    const stamp = new Date().toISOString();
    try {
      const profile = await client.currentUserProfile();
      if (profile.id !== user.flightlogger_user_id) throw new ApplicationError('Reconnect your FlightLogger key in Settings.', 409);
      const meetings = await client.dutyOps(window.startsAt, window.endsAt, false);
      await saveAssignments(db, user, profile, meetings, window, stamp, hash);
    } catch (cause) { failure = cause; }
  }
  state = await states(db, user.id, hash);
  if (!usable(state.global, window) || !usable(state.own, window)) {
    if (failure instanceof FlightLoggerError && failure.status === 429) throw new ApplicationError('FlightLogger is rate limiting Duty Ops refresh. Try again shortly.', 429, undefined, failure.retryAfterSeconds);
    throw new ApplicationError('Duty Ops could not be synchronized. Check your FlightLogger connection in Settings and try again shortly.', 503);
  }
  if (failure) warning = 'Refresh failed. Showing previously synchronized Duty Ops data.';
  const rows = await db.prepare(`SELECT id, starts_at, ends_at, status, participant_count FROM duty_ops_shifts
    WHERE starts_at < ? AND ends_at > ? ORDER BY starts_at, id`).bind(window.endsAt, window.startsAt).all<ShiftRow>();
  const participants = await db.prepare(`SELECT a.shift_id, a.user_id, u.flightlogger_user_id,
    u.flightlogger_first_name, u.flightlogger_last_name FROM duty_ops_assignments a JOIN users u ON u.id = a.user_id
    JOIN duty_ops_shifts s ON s.id = a.shift_id WHERE s.starts_at < ? AND s.ends_at > ?
    ORDER BY u.flightlogger_first_name, u.flightlogger_last_name, u.id`).bind(window.endsAt, window.startsAt).all<ParticipantRow>();
  const byShift = new Map<string, Map<string, ParticipantRow>>();
  for (const p of participants.results) {
    const group = byShift.get(p.shift_id) ?? new Map<string, ParticipantRow>();
    // One FlightLogger identity is one participant, even with multiple Access subjects.
    if (!group.has(p.flightlogger_user_id) || p.user_id === user.id) group.set(p.flightlogger_user_id, p);
    byShift.set(p.shift_id, group);
  }
  const metadata = (s: SyncState): SyncMetadata => ({ lastSyncedAt: s.last_synced_at, stale: !fresh(s, window), from: s.window_from, to: s.window_to });
  const discovery = metadata(state.global!);
  const assignments = metadata(state.own!);
  return { from: window.from, to: window.to, timeZone: 'Europe/Oslo',
    shifts: rows.results.map(s => ({ id: s.id, startsAt: s.starts_at, endsAt: s.ends_at, status: s.status, participantCount: s.participant_count,
      participants: [...(byShift.get(s.id)?.values() ?? [])].map(p => ({ userId: p.user_id, firstName: p.flightlogger_first_name, lastName: p.flightlogger_last_name, isCurrentUser: p.user_id === user.id })) })),
    sync: { stale: discovery.stale || assignments.stale || !!warning, warning, discovery, assignments } };
}

export async function loadDutyOps(db: D1Database, user: ApplicationUser, token: string, window: DutyWindow): Promise<DutyOpsResponse> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  const key = `${user.id}:${hash}:${window.startsAt}:${window.endsAt}`;
  let requests = pending.get(db);
  if (!requests) { requests = new Map(); pending.set(db, requests); }
  const active = requests.get(key);
  if (active) return active;
  const work = syncAndRead(db, user, token, window, hash);
  // Only coalesce in-flight requests; D1 remains the freshness authority.
  if (requests.size < 128) requests.set(key, work);
  try { return await work; } finally { if (requests.get(key) === work) requests.delete(key); }
}
