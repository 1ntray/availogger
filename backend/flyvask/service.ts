import { readAssignmentStates, type FlyvaskParticipant } from './effective-assignments';
import type { ParticipantIntegrity } from '../assignment-reconciliation';
import { reconcileExchangeV2IfInstalled } from '../exchange-v2/reconciliation';
import { scheduleNotificationsInstalled, scheduleObservationStatements } from '../notifications/schedule';
import { ApplicationError } from '../application-error';
import { FlightLoggerClient, FlightLoggerError } from '../flightlogger/client';
import type { FlyvaskMeeting } from '../flightlogger/flyvask';
import type { FlightLoggerProfile } from '../flightlogger/duty-ops';
import type { ApplicationUser } from '../users';
import type { FlyvaskWindow } from './window';

export const FLYVASK_TTL_MS = 5 * 60 * 1000;
// Reserve headroom for Access verification and D1 calls on Workers Free.
export const FLYVASK_MAX_REQUESTS = 30;
type SyncState = { scope: string; window_from: string; window_to: string; token_hash: string | null; last_synced_at: string };
type ShiftRow = { id: string; starts_at: string; ends_at: string; status: string; participant_count: number; classroom_id: string | null; classroom_name: string | null };
const pending = new WeakMap<D1Database, Map<string, Promise<FlyvaskResponse>>>();
export interface FlyvaskResponse {
  from: string; to: string; timeZone: 'Europe/Oslo';
  shifts: { id: string; startsAt: string; endsAt: string; status: string; participantCount: number; classroomId: string | null; classroomName: string | null;
    participants: FlyvaskParticipant[];
    flightlogger: { participantCount: number; participants: FlyvaskParticipant[] }; assignmentsDiffer: boolean;
    participantIntegrity: ParticipantIntegrity; isCurrentUserAssigned: boolean }[];
  sync: { stale: boolean; warning: string | null; discovery: SyncMetadata; assignments: SyncMetadata };
}
type SyncMetadata = { lastSyncedAt: string; stale: boolean; from: string; to: string };

function covers(state: SyncState, window: FlyvaskWindow) { return state.window_from <= window.startsAt && state.window_to >= window.endsAt; }
function fresh(state: SyncState | undefined, window: FlyvaskWindow) {
  const age = state ? Date.now() - Date.parse(state.last_synced_at) : Infinity;
  return !!state && covers(state, window) && age >= 0 && age < FLYVASK_TTL_MS;
}
function usable(state: SyncState | undefined, window: FlyvaskWindow) {
  return !!state && state.window_from < window.endsAt && state.window_to > window.startsAt;
}
async function states(db: D1Database, userId: string, hash: string) {
  const { results } = await db.prepare('SELECT * FROM flyvask_sync_state WHERE scope IN (?, ?)').bind('global', `user:${userId}`).all<SyncState>();
  return { global: results.find(s => s.scope === 'global'), own: results.find(s => s.scope === `user:${userId}` && s.token_hash === hash) };
}
function stateWrite(db: D1Database, scope: string, window: FlyvaskWindow, stamp: string, user: ApplicationUser | null, hash: string | null) {
  return db.prepare(`INSERT INTO flyvask_sync_state (scope, user_id, window_from, window_to, token_hash, last_synced_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE ? IS NULL OR EXISTS (
      SELECT 1 FROM users JOIN flightlogger_credentials c ON c.user_id = users.id
      WHERE users.id = ? AND flightlogger_user_id = ? AND c.updated_at <= ?)
    ON CONFLICT(scope) DO UPDATE SET window_from = excluded.window_from, window_to = excluded.window_to,
      token_hash = excluded.token_hash, last_synced_at = excluded.last_synced_at
    WHERE flyvask_sync_state.last_synced_at <= excluded.last_synced_at`)
    .bind(scope, user?.id ?? null, window.startsAt, window.endsAt, hash, stamp, user?.id ?? null, user?.id ?? null, user?.flightlogger_user_id ?? null, stamp);
}
function shiftWrite(db: D1Database, meetings: FlyvaskMeeting[], stamp: string, discovery: boolean, user?: ApplicationUser) {
  // JSON bulk inserts keep query/parameter counts bounded independently of booking count.
  const rows = meetings.map(m => ({ ...m, portalId: crypto.randomUUID() }));
  const guard = discovery ? '1' : `EXISTS (SELECT 1 FROM users JOIN flightlogger_credentials c ON c.user_id = users.id
    WHERE users.id = ? AND flightlogger_user_id = ? AND c.updated_at <= ?)`;
  const statement = db.prepare(`INSERT INTO flyvask_shifts
    (id, flightlogger_booking_id, starts_at, ends_at, status, participant_count, external_reference, classroom_id, classroom_name, last_synced_at)
    SELECT json_extract(value, '$.portalId'), json_extract(value, '$.id'), json_extract(value, '$.startsAt'),
      json_extract(value, '$.endsAt'), json_extract(value, '$.status'), json_extract(value, '$.participantCount'),
      json_extract(value, '$.externalReference'), json_extract(value, '$.classroomId'), json_extract(value, '$.classroomName'), ? FROM json_each(?) WHERE ${guard}
    ON CONFLICT(flightlogger_booking_id) ${discovery ? `DO UPDATE SET starts_at = excluded.starts_at, ends_at = excluded.ends_at,
      status = excluded.status, participant_count = excluded.participant_count, external_reference = excluded.external_reference,
      classroom_id = excluded.classroom_id, classroom_name = excluded.classroom_name,
      last_synced_at = excluded.last_synced_at WHERE flyvask_shifts.last_synced_at <= excluded.last_synced_at` : 'DO NOTHING'}`);
  return discovery ? statement.bind(stamp, JSON.stringify(rows)) : statement.bind(stamp, JSON.stringify(rows), user!.id, user!.flightlogger_user_id, stamp);
}

export async function saveDiscovery(db: D1Database, meetings: FlyvaskMeeting[], window: FlyvaskWindow, stamp: string) {
  await db.batch([
    shiftWrite(db, meetings, stamp, true),
    db.prepare(`DELETE FROM flyvask_shifts WHERE starts_at < ? AND ends_at > ? AND last_synced_at <= ?
      AND flightlogger_booking_id NOT IN (SELECT value FROM json_each(?))
      AND NOT EXISTS (SELECT 1 FROM flyvask_assignments a WHERE a.shift_id = flyvask_shifts.id AND a.last_seen_at > ?)`)
      .bind(window.endsAt, window.startsAt, stamp, JSON.stringify(meetings.map(m => m.id)), stamp),
    stateWrite(db, 'global', window, stamp, null, null),
  ]);
  await reconcileExchangeV2IfInstalled(db, 'FLYVASK');
}

export async function saveAssignments(db: D1Database, user: ApplicationUser, profile: FlightLoggerProfile, meetings: FlyvaskMeeting[], window: FlyvaskWindow, stamp: string, hash: string) {
  if (profile.id !== user.flightlogger_user_id) throw new ApplicationError('Your FlightLogger identity changed. Reconnect the API key in Settings.', 409);
  const ids = JSON.stringify(meetings.map(m => m.id));
  const notifications = await scheduleNotificationsInstalled(db);
  await db.batch([
    // all:false can discover a newly created booking between global refreshes, but
    // only all:true replaces canonical metadata and removes absent shared shifts.
    shiftWrite(db, meetings, stamp, false, user),
    ...(notifications ? scheduleObservationStatements(db,'FLYVASK',user,meetings,window,stamp,hash) : []),
    db.prepare(`DELETE FROM flyvask_assignments WHERE user_id = ? AND last_seen_at <= ?
      AND shift_id IN (SELECT id FROM flyvask_shifts WHERE starts_at < ? AND ends_at > ?
        AND flightlogger_booking_id NOT IN (SELECT value FROM json_each(?)))
      AND EXISTS (SELECT 1 FROM users JOIN flightlogger_credentials c ON c.user_id = users.id
        WHERE users.id = ? AND flightlogger_user_id = ? AND c.updated_at <= ?)`)
      .bind(user.id, stamp, window.endsAt, window.startsAt, ids, user.id, profile.id, stamp),
    db.prepare(`INSERT INTO flyvask_assignments (shift_id, user_id, last_seen_at)
      SELECT id, ?, ? FROM flyvask_shifts WHERE flightlogger_booking_id IN (SELECT value FROM json_each(?))
        AND EXISTS (SELECT 1 FROM users JOIN flightlogger_credentials c ON c.user_id = users.id
          WHERE users.id = ? AND flightlogger_user_id = ? AND c.updated_at <= ?)
      ON CONFLICT(shift_id, user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
      WHERE flyvask_assignments.last_seen_at <= excluded.last_seen_at`)
      .bind(user.id, stamp, ids, user.id, profile.id, stamp),
    db.prepare(`UPDATE users SET flightlogger_first_name = ?, flightlogger_last_name = ?, updated_at = ?
      WHERE id = ? AND flightlogger_user_id = ? AND updated_at <= ? AND EXISTS (
        SELECT 1 FROM flightlogger_credentials WHERE user_id = ? AND updated_at <= ?)`)
      .bind(profile.firstName, profile.lastName, stamp, user.id, profile.id, stamp, user.id, stamp),
    stateWrite(db, `user:${user.id}`, window, stamp, user, hash),
  ]);
  await reconcileExchangeV2IfInstalled(db, 'FLYVASK');
}

async function syncAndRead(db: D1Database, user: ApplicationUser, token: string, window: FlyvaskWindow, hash: string, maxRequests: number): Promise<FlyvaskResponse> {
  let state = await states(db, user.id, hash);
  const client = new FlightLoggerClient(token, undefined, maxRequests);
  let warning: string | null = null;
  let failure: unknown;
  if (!fresh(state.global, window)) {
    const stamp = new Date().toISOString();
    try { await saveDiscovery(db, await client.flyvask(window.startsAt, window.endsAt, true), window, stamp); }
    catch (cause) { failure = cause; }
  }
  if (!fresh(state.own, window)) {
    const stamp = new Date().toISOString();
    try {
      const profile = await client.currentUserProfile();
      if (profile.id !== user.flightlogger_user_id) throw new ApplicationError('Reconnect your FlightLogger key in Settings.', 409);
      const meetings = await client.flyvask(window.startsAt, window.endsAt, false);
      await saveAssignments(db, user, profile, meetings, window, stamp, hash);
    } catch (cause) { failure = cause; }
  }
  state = await states(db, user.id, hash);
  if (!usable(state.global, window) || !usable(state.own, window)) {
    if (failure instanceof FlightLoggerError && failure.status === 429) throw new ApplicationError('FlightLogger is rate limiting Flyvask refresh. Try again shortly.', 429, undefined, failure.retryAfterSeconds);
    throw new ApplicationError('Flyvask could not be synchronized. Check your FlightLogger connection in Settings and try again shortly.', 503);
  }
  if (failure) warning = 'Refresh failed. Showing previously synchronized Flyvask data.';
  const rows = await db.prepare(`SELECT id, starts_at, ends_at, status, participant_count, classroom_id, classroom_name FROM flyvask_shifts
    WHERE starts_at < ? AND ends_at > ? ORDER BY starts_at, id`).bind(window.endsAt, window.startsAt).all<ShiftRow>();
  const assignmentState = await readAssignmentStates(db, rows.results.map(s => s.id), user.id);
  const metadata = (s: SyncState): SyncMetadata => ({ lastSyncedAt: s.last_synced_at, stale: !fresh(s, window), from: s.window_from, to: s.window_to });
  const discovery = metadata(state.global!);
  const assignments = metadata(state.own!);
  return { from: window.from, to: window.to, timeZone: 'Europe/Oslo',
    shifts: rows.results.map(s => ({ id: s.id, startsAt: s.starts_at, endsAt: s.ends_at, status: s.status, classroomId: s.classroom_id, classroomName: s.classroom_name, ...assignmentState(s.id, s.participant_count) })),
    sync: { stale: discovery.stale || assignments.stale || !!warning, warning, discovery, assignments } };
}

export async function loadFlyvask(db: D1Database, user: ApplicationUser, token: string, window: FlyvaskWindow, maxRequests = FLYVASK_MAX_REQUESTS): Promise<FlyvaskResponse> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  const key = `${user.id}:${hash}:${window.startsAt}:${window.endsAt}:${maxRequests}`;
  let requests = pending.get(db);
  if (!requests) { requests = new Map(); pending.set(db, requests); }
  const active = requests.get(key);
  if (active) return active;
  const work = syncAndRead(db, user, token, window, hash, maxRequests);
  // Only coalesce in-flight requests; D1 remains the freshness authority.
  if (requests.size < 128) requests.set(key, work);
  try { return await work; } finally { if (requests.get(key) === work) requests.delete(key); }
}
