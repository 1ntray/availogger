import { ApplicationError } from '../application-error';
import type { ApplicationUser } from '../users';
import type { BrakkevaktSwaps, BrakkevaktSwapRequest, BrakkevaktSwapProposal, BrakkevaktSwapHistory } from '../../shared/brakkevakt';
import { osloDay, plusDays } from './week';
import { reconcileExchangeV2IfInstalled } from '../exchange-v2/reconciliation';

export function swapId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new ApplicationError('Use a valid swap or assignment ID.', 400, 'INVALID_BRAKKEVAKT_SWAP');
  return value;
}
const conflict = () => new ApplicationError('This Brakkevakt swap changed. Reload before trying again.', 409, 'BRAKKEVAKT_CONFLICT');
const stamp = () => new Date().toISOString();
const activeRequest = `EXISTS (SELECT 1 FROM brakkevakt_assignments a JOIN brakkevakt_periods w ON w.id = a.period_id
  JOIN brakkevakt_swap_reservations l ON l.assignment_id = a.id AND l.request_id = r.id AND l.proposal_id IS NULL
  WHERE a.id = r.requested_assignment_id AND a.user_id = r.requester_user_id AND w.published = 1 AND w.week_start = r.requested_week_start
  AND date(w.week_start, '+7 days') > ?)`;
const activeProposal = `EXISTS (SELECT 1 FROM brakkevakt_assignments a JOIN brakkevakt_periods w ON w.id = a.period_id
  JOIN brakkevakt_swap_reservations l ON l.assignment_id = a.id AND l.proposal_id = p.id
  WHERE a.id = p.offered_assignment_id AND a.user_id = p.proposer_user_id AND w.published = 1 AND w.week_start = p.offered_week_start
  AND date(w.week_start, '+7 days') > ?)`;
const validTeams = `NOT EXISTS (SELECT 1 FROM brakkevakt_assignments other JOIN users u ON u.id = other.user_id
  JOIN users incoming ON incoming.id = p.proposer_user_id WHERE other.period_id =
    (SELECT period_id FROM brakkevakt_assignments WHERE id = r.requested_assignment_id)
  AND other.id <> r.requested_assignment_id
  AND COALESCE(u.flightlogger_user_id, 'portal:' || u.id) = COALESCE(incoming.flightlogger_user_id, 'portal:' || incoming.id))
  AND NOT EXISTS (SELECT 1 FROM brakkevakt_assignments other JOIN users u ON u.id = other.user_id
  JOIN users incoming ON incoming.id = r.requester_user_id WHERE other.period_id =
    (SELECT period_id FROM brakkevakt_assignments WHERE id = p.offered_assignment_id)
  AND other.id <> p.offered_assignment_id
  AND COALESCE(u.flightlogger_user_id, 'portal:' || u.id) = COALESCE(incoming.flightlogger_user_id, 'portal:' || incoming.id))`;
const event = (db: D1Database, requestId: string, actor: ApplicationUser, type: string, now: string, proposalId: string | null = null) =>
  db.prepare('INSERT INTO brakkevakt_swap_events VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), requestId, actor.id, type, proposalId, now);
async function transaction(db: D1Database, actor: ApplicationUser, predicate: string, values: (string | number | null)[], writes: D1PreparedStatement[]) {
  try { await db.batch([
    db.prepare(`UPDATE brakkevakt_state SET revision = CASE WHEN
      EXISTS (SELECT 1 FROM effective_user_permissions WHERE user_id = ? AND permission_key = 'brakkevakt.swap')
      AND (${predicate}) THEN revision + 1 ELSE -1 END WHERE id = 1`).bind(actor.id, ...values), ...writes,
  ]); } catch { throw conflict(); }
}
export async function createSwap(db: D1Database, actor: ApplicationUser, assignmentId: string) {
  const id = crypto.randomUUID(), now = stamp(), today = osloDay();
  await transaction(db, actor, `EXISTS (SELECT 1 FROM brakkevakt_assignments a JOIN brakkevakt_periods w ON w.id = a.period_id
    WHERE a.id = ? AND a.user_id = ? AND w.published = 1 AND date(w.week_start, '+7 days') > ?)
    AND NOT EXISTS (SELECT 1 FROM brakkevakt_swap_reservations WHERE assignment_id = ?)`,
    [assignmentId, actor.id, today, assignmentId], [
      db.prepare(`INSERT INTO brakkevakt_swap_requests (id, requester_user_id, requested_assignment_id, requested_week_start, status, created_at, updated_at)
        SELECT ?, ?, a.id, w.week_start, 'OPEN', ?, ? FROM brakkevakt_assignments a JOIN brakkevakt_periods w ON w.id = a.period_id WHERE a.id = ?`)
        .bind(id, actor.id, now, now, assignmentId),
      db.prepare('INSERT INTO brakkevakt_swap_reservations VALUES (?, ?, ?, NULL)').bind(assignmentId, actor.id, id),
      event(db, id, actor, 'REQUEST_CREATED', now),
    ]);
  return { id };
}
export async function proposeSwap(db: D1Database, actor: ApplicationUser, requestId: string, assignmentId: string) {
  const id = crypto.randomUUID(), now = stamp(), today = osloDay();
  await transaction(db, actor, `EXISTS (SELECT 1 FROM brakkevakt_swap_requests r JOIN brakkevakt_assignments a ON a.id = ?
    JOIN brakkevakt_periods w ON w.id = a.period_id JOIN brakkevakt_assignments requested ON requested.id = r.requested_assignment_id
    WHERE r.id = ? AND r.status = 'OPEN' AND r.requester_user_id <> ? AND a.user_id = ? AND requested.user_id = r.requester_user_id
    AND a.period_id <> requested.period_id AND w.published = 1 AND date(w.week_start, '+7 days') > ?
    AND ${activeRequest}
    AND NOT EXISTS (SELECT 1 FROM brakkevakt_swap_reservations WHERE assignment_id = ?)
    AND (SELECT COUNT(*) FROM brakkevakt_swap_proposals WHERE request_id = r.id) < 50
    AND NOT EXISTS (SELECT 1 FROM brakkevakt_swap_proposals WHERE request_id = r.id AND proposer_user_id = ? AND status = 'OPEN'))`,
    [assignmentId, requestId, actor.id, actor.id, today, today, assignmentId, actor.id], [
      db.prepare(`INSERT INTO brakkevakt_swap_proposals (id, request_id, proposer_user_id, offered_assignment_id, offered_week_start, status, created_at, updated_at)
        SELECT ?, ?, ?, a.id, w.week_start, 'OPEN', ?, ? FROM brakkevakt_assignments a JOIN brakkevakt_periods w ON w.id = a.period_id WHERE a.id = ?`)
        .bind(id, requestId, actor.id, now, now, assignmentId),
      db.prepare('INSERT INTO brakkevakt_swap_reservations VALUES (?, ?, ?, ?)').bind(assignmentId, actor.id, requestId, id),
      event(db, requestId, actor, 'PROPOSAL_CREATED', now, id),
    ]);
  return { id };
}
export async function acceptSwap(db: D1Database, actor: ApplicationUser, requestId: string, proposalId: string) {
  const now = stamp(), today = osloDay();
  await transaction(db, actor, `EXISTS (SELECT 1 FROM brakkevakt_swap_requests r JOIN brakkevakt_swap_proposals p ON p.request_id = r.id
    JOIN brakkevakt_assignments ra ON ra.id = r.requested_assignment_id JOIN brakkevakt_assignments pa ON pa.id = p.offered_assignment_id
    WHERE r.id = ? AND p.id = ? AND r.requester_user_id = ? AND r.status = 'OPEN' AND p.status = 'OPEN'
    AND ra.user_id = r.requester_user_id AND pa.user_id = p.proposer_user_id AND ra.period_id <> pa.period_id
    AND ${activeRequest} AND ${activeProposal} AND ${validTeams})`, [requestId, proposalId, actor.id, today, today], [
      db.prepare(`UPDATE brakkevakt_swap_requests SET status = 'ACCEPTED', accepted_by_user_id =
        (SELECT proposer_user_id FROM brakkevakt_swap_proposals WHERE id = ?), accepted_proposal_id = ?, accepted_at = ?, updated_at = ? WHERE id = ?`)
        .bind(proposalId, proposalId, now, now, requestId),
      db.prepare(`UPDATE brakkevakt_swap_proposals SET status = CASE WHEN id = ? THEN 'ACCEPTED' ELSE 'NOT_SELECTED' END,
        updated_at = ? WHERE request_id = ? AND status = 'OPEN'`).bind(proposalId, now, requestId),
      db.prepare(`UPDATE brakkevakt_assignments SET user_id = CASE WHEN id = (SELECT requested_assignment_id FROM brakkevakt_swap_requests WHERE id = ?)
        THEN (SELECT proposer_user_id FROM brakkevakt_swap_proposals WHERE id = ?) ELSE ? END,
        updated_at = ?, updated_by_user_id = ? WHERE id IN
        ((SELECT requested_assignment_id FROM brakkevakt_swap_requests WHERE id = ?), (SELECT offered_assignment_id FROM brakkevakt_swap_proposals WHERE id = ?))`)
        .bind(requestId, proposalId, actor.id, now, actor.id, requestId, proposalId),
      db.prepare(`UPDATE brakkevakt_periods SET revision = revision + 1, updated_at = ?, updated_by_user_id = ? WHERE id IN
        (SELECT period_id FROM brakkevakt_assignments WHERE id IN
        ((SELECT requested_assignment_id FROM brakkevakt_swap_requests WHERE id = ?), (SELECT offered_assignment_id FROM brakkevakt_swap_proposals WHERE id = ?)))`)
        .bind(now, actor.id, requestId, proposalId),
      db.prepare('DELETE FROM brakkevakt_swap_reservations WHERE request_id = ?').bind(requestId),
      event(db, requestId, actor, 'PROPOSAL_ACCEPTED', now, proposalId),
    ]);
  await reconcileExchangeV2IfInstalled(db, 'BRAKKEVAKT');
  return { id: requestId };
}
export async function cancelSwap(db: D1Database, actor: ApplicationUser, id: string) {
  const now = stamp();
  await transaction(db, actor, `EXISTS (SELECT 1 FROM brakkevakt_swap_requests WHERE id = ? AND requester_user_id = ? AND status = 'OPEN')`, [id, actor.id], [
    db.prepare(`UPDATE brakkevakt_swap_requests SET status = 'CANCELLED', cancelled_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, id),
    db.prepare(`UPDATE brakkevakt_swap_proposals SET status = 'NOT_SELECTED', updated_at = ? WHERE request_id = ? AND status = 'OPEN'`).bind(now, id),
    db.prepare('DELETE FROM brakkevakt_swap_reservations WHERE request_id = ?').bind(id), event(db, id, actor, 'REQUEST_CANCELLED', now),
  ]); return { id };
}
export async function withdrawSwap(db: D1Database, actor: ApplicationUser, requestId: string, proposalId: string) {
  const now = stamp();
  await transaction(db, actor, `EXISTS (SELECT 1 FROM brakkevakt_swap_proposals p JOIN brakkevakt_swap_requests r ON r.id = p.request_id
    WHERE p.id = ? AND r.id = ? AND p.proposer_user_id = ? AND p.status = 'OPEN' AND r.status = 'OPEN')`, [proposalId, requestId, actor.id], [
    db.prepare(`UPDATE brakkevakt_swap_proposals SET status = 'WITHDRAWN', updated_at = ? WHERE id = ?`).bind(now, proposalId),
    db.prepare('DELETE FROM brakkevakt_swap_reservations WHERE proposal_id = ?').bind(proposalId),
    event(db, requestId, actor, 'PROPOSAL_WITHDRAWN', now, proposalId),
  ]); return { id: proposalId };
}
function cursorParts(cursor: string | null) {
  if (!cursor) return ['9999', 'ffffffff-ffff-ffff-ffff-ffffffffffff'];
  const parts = cursor.split('|');
  if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\.\d{3}Z$/.test(parts[0]) || !Number.isFinite(Date.parse(parts[0])) ||
    new Date(parts[0]).toISOString() !== parts[0]) throw new ApplicationError('Use a valid swap cursor.', 400);
  return [parts[0], swapId(parts[1])];
}
const person = (id: unknown, first: unknown, last: unknown) => ({ id: id as string, firstName: first as string | null, lastName: last as string | null });
export async function listSwaps(db: D1Database, actor: ApplicationUser, cursor: string | null): Promise<BrakkevaktSwaps> {
  const today = osloDay(), [before, beforeId] = cursorParts(cursor);
  const page = await db.prepare(`SELECT r.*, u.flightlogger_first_name first_name, u.flightlogger_last_name last_name,
    ${activeRequest} AS eligible FROM brakkevakt_swap_requests r JOIN users u ON u.id = r.requester_user_id
    WHERE r.status = 'OPEN' AND (r.requester_user_id = ? OR EXISTS (SELECT 1 FROM brakkevakt_swap_proposals p WHERE p.request_id = r.id
      AND p.proposer_user_id = ? AND p.status = 'OPEN') OR ${activeRequest})
    AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))
    ORDER BY r.created_at DESC, r.id DESC LIMIT 31`).bind(today, actor.id, actor.id, today, before, before, beforeId).all<Record<string, unknown>>();
  const rows = page.results.slice(0, 30);
  const [proposals, locks] = await db.batch([
    db.prepare(`SELECT p.*, u.flightlogger_first_name first_name, u.flightlogger_last_name last_name,
      ${activeProposal} AS eligible FROM brakkevakt_swap_proposals p JOIN brakkevakt_swap_requests r ON r.id = p.request_id
      JOIN users u ON u.id = p.proposer_user_id WHERE p.status = 'OPEN' AND p.request_id IN (SELECT value FROM json_each(?))
      AND (r.requester_user_id = ? OR p.proposer_user_id = ?) ORDER BY p.created_at, p.id`)
      .bind(today, JSON.stringify(rows.map(r => r.id)), actor.id, actor.id),
    db.prepare('SELECT assignment_id FROM brakkevakt_swap_reservations WHERE user_id = ?').bind(actor.id),
  ]);
  const allProposals = proposals.results as Record<string, unknown>[];
  const requests: BrakkevaktSwapRequest[] = rows.map(r => ({ id: r.id as string, requester: person(r.requester_user_id, r.first_name, r.last_name),
    requestedAssignmentId: r.requested_assignment_id as string | null, requestedWeekStart: r.requested_week_start as string,
    status: r.status as BrakkevaktSwapRequest['status'], createdAt: r.created_at as string, eligible: !!r.eligible,
    proposals: allProposals.filter(p => p.request_id === r.id).map(p => ({ id: p.id as string,
      proposer: person(p.proposer_user_id, p.first_name, p.last_name), offeredAssignmentId: p.offered_assignment_id as string | null,
      offeredWeekStart: p.offered_week_start as string, status: p.status as BrakkevaktSwapProposal['status'],
      createdAt: p.created_at as string, eligible: !!p.eligible })) }));
  const last = rows.at(-1);
  return { currentUserId: actor.id, requests, lockedAssignmentIds: (locks.results as { assignment_id: string }[]).map(r => r.assignment_id),
    nextCursor: page.results.length > 30 && last ? `${last.created_at}|${last.id}` : null };
}
export async function listSwapHistory(db: D1Database, actor: ApplicationUser, cursor: string | null): Promise<BrakkevaktSwapHistory> {
  const [before, beforeId] = cursorParts(cursor);
  const page = await db.prepare(`SELECT r.id, r.requester_user_id, r.accepted_by_user_id, r.requested_week_start, r.accepted_at,
    p.offered_week_start, u.id AS counterparty_id, u.flightlogger_first_name first_name, u.flightlogger_last_name last_name
    FROM brakkevakt_swap_requests r JOIN brakkevakt_swap_proposals p ON p.id = r.accepted_proposal_id
    JOIN users u ON u.id = CASE WHEN r.requester_user_id = ? THEN r.accepted_by_user_id ELSE r.requester_user_id END
    WHERE r.status = 'ACCEPTED' AND (r.requester_user_id = ? OR r.accepted_by_user_id = ?)
    AND (r.accepted_at < ? OR (r.accepted_at = ? AND r.id < ?)) ORDER BY r.accepted_at DESC, r.id DESC LIMIT 31`)
    .bind(actor.id, actor.id, actor.id, before, before, beforeId).all<Record<string, unknown>>();
  const rows = page.results.slice(0, 30), last = rows.at(-1);
  return { entries: rows.map(r => ({ id: r.id as string, counterparty: person(r.counterparty_id, r.first_name, r.last_name),
    givenWeekStart: (r.requester_user_id === actor.id ? r.requested_week_start : r.offered_week_start) as string,
    receivedWeekStart: (r.requester_user_id === actor.id ? r.offered_week_start : r.requested_week_start) as string,
    acceptedAt: r.accepted_at as string })), nextCursor: page.results.length > 30 && last ? `${last.accepted_at}|${last.id}` : null };
}
