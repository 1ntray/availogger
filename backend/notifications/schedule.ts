import type { ApplicationUser } from '../users';
import { scheduleAdditionGroupStatements } from './groups';

export type ScheduleDomain = 'DUTY_OPS' | 'FLYVASK';
type Meeting = { id: string; startsAt: string; endsAt: string; status: string };
type Window = { startsAt: string; endsAt: string };

export async function scheduleNotificationsInstalled(db: D1Database) {
  return !!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schedule_observation_state'").first();
}

// Called inside the same D1 batch as the raw assignment write. The dedicated
// observation state makes the first sync after installation or key replacement
// a baseline, including when the old raw assignment rows still exist.
export function scheduleObservationStatements(db: D1Database, domain: ScheduleDomain, user: ApplicationUser,
  meetings: Meeting[], window: Window, stamp: string, hash: string): D1PreparedStatement[] {
  const table = domain === 'DUTY_OPS' ? 'duty_ops_shifts' : 'flyvask_shifts';
  const rows = JSON.stringify(meetings.map(m => ({ id:m.id, startsAt:m.startsAt, endsAt:m.endsAt, status:m.status })));
  const observationId = crypto.randomUUID();
  const id = "json_extract(j.value,'$.id')", start = "json_extract(j.value,'$.startsAt')";
  const end = "json_extract(j.value,'$.endsAt')", status = "json_extract(j.value,'$.status')";
  const valid = `EXISTS(SELECT 1 FROM users u JOIN flightlogger_credentials c ON c.user_id=u.id
    WHERE u.id=? AND u.flightlogger_user_id=? AND c.updated_at<=?)`;
  const current = [user.id,user.flightlogger_user_id,stamp];
  const notOlder = `NOT EXISTS(SELECT 1 FROM schedule_observation_state newer
    WHERE newer.user_id=? AND newer.domain=? AND newer.last_synced_at>?)`;
  const orderArgs = [user.id,domain,stamp];
  const state = `JOIN schedule_observation_state st ON st.user_id=? AND st.domain=?
    AND st.token_hash=? AND st.last_synced_at<=?`;
  const stateArgs = [user.id,domain,hash,stamp];
  const incoming = `FROM json_each(?) j JOIN ${table} s ON s.flightlogger_booking_id=${id}`;
  const previous = `LEFT JOIN schedule_assignment_snapshots old ON old.user_id=? AND old.domain=? AND old.source_booking_id=${id}`;
  const assigned = db.prepare(`INSERT INTO schedule_change_events
    (id,user_id,domain,type,source_booking_id,source_assignment_id,detected_at,observation_id,new_starts_at,new_ends_at)
    SELECT lower(hex(randomblob(16))),?,?,'ASSIGNED',${id},s.id,?,?,${start},${end}
    ${incoming} ${state} ${previous}
    WHERE old.source_booking_id IS NULL AND ${status}<>'CANCELLED'
      AND ${start}<min(st.window_to,?) AND ${end}>max(st.window_from,?) AND ${valid}`)
    .bind(user.id,domain,stamp,observationId,rows,...stateArgs,user.id,domain,
      window.endsAt,window.startsAt,...current);
  const timeChanged = db.prepare(`INSERT INTO schedule_change_events
    (id,user_id,domain,type,source_booking_id,source_assignment_id,detected_at,observation_id,
      old_starts_at,old_ends_at,new_starts_at,new_ends_at)
    SELECT lower(hex(randomblob(16))),?,?,'TIME_CHANGED',${id},s.id,?,?,
      old.starts_at,old.ends_at,${start},${end}
    ${incoming} ${state} JOIN schedule_assignment_snapshots old
      ON old.user_id=? AND old.domain=? AND old.source_booking_id=${id}
    WHERE old.last_seen_at<=? AND (old.starts_at IS NOT ${start} OR old.ends_at IS NOT ${end})
      AND old.starts_at<min(st.window_to,?) AND old.ends_at>max(st.window_from,?) AND ${valid}`)
    .bind(user.id,domain,stamp,observationId,rows,...stateArgs,user.id,domain,stamp,
      window.endsAt,window.startsAt,...current);
  const removed = db.prepare(`INSERT INTO schedule_change_events
    (id,user_id,domain,type,source_booking_id,source_assignment_id,detected_at,observation_id,
      old_starts_at,old_ends_at)
    SELECT lower(hex(randomblob(16))),?,?,'REMOVED',old.source_booking_id,old.source_assignment_id,?,?,
      old.starts_at,old.ends_at
    FROM schedule_assignment_snapshots old ${state}
    WHERE old.user_id=? AND old.domain=? AND old.last_seen_at<=?
      AND old.starts_at<min(st.window_to,?) AND old.ends_at>max(st.window_from,?)
      AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE ${id}=old.source_booking_id) AND ${valid}`)
    .bind(user.id,domain,stamp,observationId,...stateArgs,user.id,domain,stamp,
      window.endsAt,window.startsAt,rows,...current);
  const details = db.prepare(`INSERT INTO user_inbox_items(id,user_id,kind,source_type,source_id,created_at,read_at)
    SELECT lower(hex(randomblob(16))),?, 'SCHEDULE_CHANGE','SCHEDULE_CHANGE',id,?,NULL
    FROM schedule_change_events WHERE observation_id=? AND user_id=? AND type IN ('REMOVED','TIME_CHANGED')`)
    .bind(user.id,stamp,observationId,user.id);
  const removeSnapshot = db.prepare(`DELETE FROM schedule_assignment_snapshots WHERE user_id=? AND domain=?
    AND last_seen_at<=? AND starts_at<? AND ends_at>?
    AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE ${id}=source_booking_id) AND ${valid} AND ${notOlder}`)
    .bind(user.id,domain,stamp,window.endsAt,window.startsAt,rows,...current,...orderArgs);
  const upsertSnapshot = db.prepare(`INSERT INTO schedule_assignment_snapshots
    (user_id,domain,source_booking_id,source_assignment_id,starts_at,ends_at,status,last_seen_at)
    SELECT ?,?,${id},s.id,${start},${end},${status},? ${incoming} WHERE ${valid} AND ${notOlder}
    ON CONFLICT(user_id,domain,source_booking_id) DO UPDATE SET
      source_assignment_id=excluded.source_assignment_id,starts_at=excluded.starts_at,
      ends_at=excluded.ends_at,status=excluded.status,last_seen_at=excluded.last_seen_at
    WHERE schedule_assignment_snapshots.last_seen_at<=excluded.last_seen_at`)
    .bind(user.id,domain,stamp,rows,...current,...orderArgs);
  const saveState = db.prepare(`INSERT INTO schedule_observation_state
    (user_id,domain,token_hash,window_from,window_to,last_synced_at)
    SELECT ?,?,?,?,?,? WHERE ${valid} AND ${notOlder}
    ON CONFLICT(user_id,domain) DO UPDATE SET token_hash=excluded.token_hash,
      window_from=excluded.window_from,window_to=excluded.window_to,last_synced_at=excluded.last_synced_at
    WHERE schedule_observation_state.last_synced_at<=excluded.last_synced_at`)
    .bind(user.id,domain,hash,window.startsAt,window.endsAt,stamp,...current,...orderArgs);
  return [assigned,timeChanged,removed,
    ...scheduleAdditionGroupStatements(db,user.id,domain,observationId,stamp),details,
    removeSnapshot,upsertSnapshot,saveState];
}
