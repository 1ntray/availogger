import { ApplicationError } from '../application-error';
import type { ApplicationUser } from '../users';
import type { BrakkevaktSchedule, BrakkevaktWeek, BrakkevaktRoster } from '../../shared/brakkevakt';
import { currentWeekStart, requireWeek, weekActive } from './week';

type AssignmentRow = { id: string; period_id: string; slot: 1 | 2; user_id: string; first_name: string | null; last_name: string | null };
export async function listSchedule(db: D1Database, actor: ApplicationUser): Promise<BrakkevaktSchedule> {
  const [periods, assignments] = await db.batch([
    db.prepare('SELECT id, week_start, revision FROM brakkevakt_periods WHERE published = 1 ORDER BY week_start'),
    db.prepare(`SELECT a.id, a.period_id, a.slot, a.user_id, u.flightlogger_first_name AS first_name, u.flightlogger_last_name AS last_name
      FROM brakkevakt_assignments a JOIN users u ON u.id = a.user_id ORDER BY a.period_id, a.slot`),
  ]);
  const byPeriod = new Map<string, AssignmentRow[]>();
  for (const row of assignments.results as AssignmentRow[]) byPeriod.set(row.period_id, [...(byPeriod.get(row.period_id) ?? []), row]);
  return { currentUserId: actor.id, currentWeekStart: currentWeekStart(), weeks: (periods.results as { id: string; week_start: string; revision: number }[]).map(p => {
    const rows = byPeriod.get(p.id) ?? [];
    if (rows.length !== 2) throw new ApplicationError('Brakkevakt schedule is incomplete.', 503);
    return { id: p.id, weekStart: p.week_start, revision: p.revision,
      assignments: rows.map(a => ({ id: a.id, slot: a.slot, user: { id: a.user_id, firstName: a.first_name, lastName: a.last_name } })) as BrakkevaktWeek['assignments'] };
  }) };
}
export async function listRoster(db: D1Database): Promise<BrakkevaktRoster> {
  const { results } = await db.prepare(`SELECT u.id, u.flightlogger_first_name AS first_name, u.flightlogger_last_name AS last_name
    FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
    WHERE r.key = 'STUDENT' ORDER BY COALESCE(u.flightlogger_first_name, ''), COALESCE(u.flightlogger_last_name, ''), u.id`).all<{ id: string; first_name: string | null; last_name: string | null }>();
  return { students: results.map(r => ({ id: r.id, firstName: r.first_name, lastName: r.last_name })) };
}
const guard = (db: D1Database, actor: ApplicationUser, predicate: string, values: (string | number | null)[]) => db.prepare(`UPDATE brakkevakt_state
  SET revision = CASE WHEN EXISTS (SELECT 1 FROM effective_user_permissions WHERE user_id = ? AND permission_key = 'brakkevakt.manage_schedule')
  AND (${predicate}) THEN revision + 1 ELSE -1 END WHERE id = 1`).bind(actor.id, ...values);
const event = (db: D1Database, actor: ApplicationUser, periodId: string, weekStart: string, type: string, now: string,
  assignmentId: string | null = null, oldUser: string | null = null, newUser: string | null = null) =>
  db.prepare(`INSERT INTO brakkevakt_schedule_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), actor.id, periodId, weekStart,
    assignmentId, oldUser, newUser, type, now);
const changedIds = (rows: AssignmentRow[], next: string[]) => rows.filter(r => !next.includes(r.user_id)).map(r => r.id);
// Runs before owner changes and period removal, inside the same guarded D1 batch.
function invalidate(db: D1Database, actor: ApplicationUser, ids: string[], now: string): D1PreparedStatement[] {
  if (!ids.length) return [];
  const keys = JSON.stringify(ids);
  return [
    db.prepare(`INSERT INTO brakkevakt_swap_events SELECT lower(hex(randomblob(16))), r.id, ?, 'REQUEST_INVALIDATED', NULL, ?
      FROM brakkevakt_swap_requests r WHERE r.status = 'OPEN' AND r.requested_assignment_id IN (SELECT value FROM json_each(?))`).bind(actor.id, now, keys),
    db.prepare(`INSERT INTO brakkevakt_swap_events SELECT lower(hex(randomblob(16))), p.request_id, ?, 'PROPOSAL_INVALIDATED', p.id, ?
      FROM brakkevakt_swap_proposals p JOIN brakkevakt_swap_requests r ON r.id = p.request_id WHERE p.status = 'OPEN' AND r.status = 'OPEN'
      AND (r.requested_assignment_id IN (SELECT value FROM json_each(?)) OR p.offered_assignment_id IN (SELECT value FROM json_each(?)))`).bind(actor.id, now, keys, keys),
    db.prepare(`UPDATE brakkevakt_swap_proposals SET status = 'INVALIDATED', updated_at = ? WHERE status = 'OPEN' AND
      (offered_assignment_id IN (SELECT value FROM json_each(?)) OR request_id IN
        (SELECT id FROM brakkevakt_swap_requests WHERE status = 'OPEN' AND requested_assignment_id IN (SELECT value FROM json_each(?))))`).bind(now, keys, keys),
    db.prepare(`UPDATE brakkevakt_swap_requests SET status = 'INVALIDATED', invalidated_at = ?, updated_at = ? WHERE status = 'OPEN'
      AND requested_assignment_id IN (SELECT value FROM json_each(?))`).bind(now, now, keys),
    db.prepare(`DELETE FROM brakkevakt_swap_reservations WHERE request_id IN
      (SELECT id FROM brakkevakt_swap_requests WHERE status = 'INVALIDATED') OR proposal_id IN
      (SELECT id FROM brakkevakt_swap_proposals WHERE status = 'INVALIDATED')`),
  ];
}
type SaveInput = { userIds: [string, string]; revision: number | null };
export async function saveWeek(db: D1Database, actor: ApplicationUser, week: string, input: SaveInput) {
  requireWeek(week);
  if (!weekActive(week)) throw new ApplicationError('Past Brakkevakt weeks cannot be changed.', 409, 'BRAKKEVAKT_CONFLICT');
  const current = await db.prepare('SELECT id, revision FROM brakkevakt_periods WHERE week_start = ?').bind(week).first<{ id: string; revision: number }>();
  if ((current?.revision ?? null) !== input.revision) throw new ApplicationError('Schedule changed. Reload before saving.', 409, 'BRAKKEVAKT_CONFLICT');
  const students = await db.prepare(`SELECT u.id, COALESCE(u.flightlogger_user_id, 'portal:' || u.id) AS identity FROM users u
    WHERE u.id IN (?, ?) AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key = 'STUDENT')`)
    .bind(...input.userIds).all<{ id: string; identity: string }>();
  if (students.results.length !== 2 || students.results[0].identity === students.results[1].identity)
    throw new ApplicationError('Choose two distinct portal students.', 400, 'INVALID_BRAKKEVAKT_ROSTER');
  const rows = current ? (await db.prepare('SELECT id, period_id, slot, user_id FROM brakkevakt_assignments WHERE period_id = ? ORDER BY slot').bind(current.id).all<AssignmentRow>()).results : [];
  const id = current?.id ?? crypto.randomUUID(), now = new Date().toISOString(), writes: D1PreparedStatement[] = [];
  if (!current) {
    writes.push(db.prepare('INSERT INTO brakkevakt_periods VALUES (?, ?, 0, 0, ?, ?, ?, ?)').bind(id, week, now, actor.id, now, actor.id));
    writes.push(event(db, actor, id, week, 'PERIOD_CREATED', now));
    input.userIds.forEach((userId, index) => {
      const assignmentId = crypto.randomUUID();
      writes.push(db.prepare('INSERT INTO brakkevakt_assignments VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(assignmentId, id, index + 1, userId, now, actor.id, now, actor.id));
      writes.push(event(db, actor, id, week, 'ASSIGNMENT_CREATED', now, assignmentId, null, userId));
    });
    writes.push(db.prepare('UPDATE brakkevakt_periods SET published = 1, revision = 1 WHERE id = ?').bind(id));
  } else {
    // Retain each existing owner in their stable slot, even if the submitted pair is reversed.
    const keep = rows.filter(row => input.userIds.includes(row.user_id));
    const incoming = input.userIds.filter(userId => !keep.some(row => row.user_id === userId));
    const replace = rows.filter(row => !keep.includes(row));
    writes.push(...invalidate(db, actor, changedIds(rows, input.userIds), now));
    replace.forEach((row, index) => {
      const newUser = incoming[index];
      writes.push(db.prepare('UPDATE brakkevakt_assignments SET user_id = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?')
        .bind(newUser, now, actor.id, row.id));
      writes.push(event(db, actor, id, week, 'ASSIGNMENT_CHANGED', now, row.id, row.user_id, newUser));
    });
    writes.push(db.prepare('UPDATE brakkevakt_periods SET revision = revision + 1, updated_at = ?, updated_by_user_id = ? WHERE id = ?').bind(now, actor.id, id));
  }
  try {
    await db.batch([guard(db, actor, current ? 'EXISTS (SELECT 1 FROM brakkevakt_periods WHERE id = ? AND revision = ?)' : 'NOT EXISTS (SELECT 1 FROM brakkevakt_periods WHERE week_start = ?)',
      current ? [id, input.revision] : [week]), ...writes]);
  } catch { throw new ApplicationError('Schedule changed or access was removed. Reload before saving.', 409, 'BRAKKEVAKT_CONFLICT'); }
  return { id, weekStart: week, revision: (current?.revision ?? 0) + 1 };
}
export async function removeWeek(db: D1Database, actor: ApplicationUser, week: string, revision: number) {
  requireWeek(week);
  if (week <= currentWeekStart()) throw new ApplicationError('Only future weeks can be removed.', 409, 'BRAKKEVAKT_CONFLICT');
  const current = await db.prepare('SELECT id, revision FROM brakkevakt_periods WHERE week_start = ?').bind(week).first<{ id: string; revision: number }>();
  if (!current || current.revision !== revision) throw new ApplicationError('Schedule changed. Reload before removing.', 409, 'BRAKKEVAKT_CONFLICT');
  const rows = (await db.prepare('SELECT id FROM brakkevakt_assignments WHERE period_id = ?').bind(current.id).all<{ id: string }>()).results;
  const now = new Date().toISOString();
  try { await db.batch([
    guard(db, actor, 'EXISTS (SELECT 1 FROM brakkevakt_periods WHERE id = ? AND revision = ?)', [current.id, revision]),
    ...invalidate(db, actor, rows.map(r => r.id), now),
    event(db, actor, current.id, week, 'PERIOD_REMOVED', now),
    db.prepare('UPDATE brakkevakt_state SET deleting_period_id = ? WHERE id = 1').bind(current.id),
    db.prepare('DELETE FROM brakkevakt_periods WHERE id = ?').bind(current.id),
    db.prepare('UPDATE brakkevakt_state SET deleting_period_id = NULL WHERE id = 1'),
  ]); } catch { throw new ApplicationError('Schedule changed or access was removed. Reload before removing.', 409, 'BRAKKEVAKT_CONFLICT'); }
  return { weekStart: week };
}
