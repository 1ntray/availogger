import { activeReservations, effectiveAssignments } from './effective-assignments';
import { ApplicationError } from '../application-error';
import type { ApplicationUser } from '../users';
import type { ExchangeRequest, ExchangeProposal, ExchangesResponse, RequestStatus, ProposalStatus } from '../../shared/flyvask-swaps';

// Consent covers the displayed times, not a subsequently rescheduled booking.
const requestedEligible = `EXISTS (SELECT 1 FROM flyvask_shifts s JOIN ${effectiveAssignments} a ON a.shift_id = s.id
  WHERE s.id = r.requested_shift_id AND a.user_id = r.requester_user_id AND s.status = 'OPEN'
  AND s.starts_at > ? AND s.starts_at = r.requested_starts_at AND s.ends_at = r.requested_ends_at)`;
const offeredEligible = `EXISTS (SELECT 1 FROM flyvask_shifts s JOIN ${effectiveAssignments} a ON a.shift_id = s.id
  WHERE s.id = p.offered_shift_id AND a.user_id = p.proposer_user_id AND s.status = 'OPEN'
  AND s.starts_at > ? AND s.starts_at = p.offered_starts_at AND s.ends_at = p.offered_ends_at)`;
const requestReservation = `EXISTS (SELECT 1 FROM ${activeReservations} l
  WHERE l.user_id = r.requester_user_id AND l.shift_id = r.requested_shift_id AND l.request_id = r.id AND l.proposal_id IS NULL)`;
const proposalReservation = `EXISTS (SELECT 1 FROM ${activeReservations} l
  WHERE l.user_id = p.proposer_user_id AND l.shift_id = p.offered_shift_id AND l.request_id = r.id AND l.proposal_id = p.id)`;
const distinctIdentity = `EXISTS (SELECT 1 FROM users x JOIN users y ON y.id = r.requester_user_id
  WHERE x.id = ? AND x.id <> y.id AND x.flightlogger_user_id IS NOT NULL AND y.flightlogger_user_id IS NOT NULL
  AND x.flightlogger_user_id <> y.flightlogger_user_id)`;
const freeShift = `NOT EXISTS (SELECT 1 FROM ${activeReservations} WHERE user_id = ? AND shift_id = ?)`;
const noAssignment = `NOT EXISTS (SELECT 1 FROM ${effectiveAssignments} a JOIN users u ON u.id = a.user_id
  WHERE a.shift_id = ? AND u.flightlogger_user_id = (SELECT flightlogger_user_id FROM users WHERE id = ?))`;
// Allocate inside the guarded transaction, not in a pre-read. New acceptances
// have strict order even when chains/concurrent writes share a clock millisecond.
const acceptedTimestamp = `strftime('%Y-%m-%dT%H:%M:%fZ',
  MAX(?, COALESCE((SELECT MAX(accepted_at) FROM flyvask_swap_requests), '1970-01-01T00:00:00.000Z')), '+0.001 seconds')`;

export function exchangeId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApplicationError('Use a valid exchange or shift ID.', 400);
  }
  return value;
}
const conflict = () => new ApplicationError('This exchange changed or the shift is no longer eligible. Reload Flyvask.', 409, 'EXCHANGE_CONFLICT');
async function transaction(db: D1Database, actor: ApplicationUser, predicate: string, values: (string | number | null)[], writes: D1PreparedStatement[]) {
  try {
    await db.batch([
      db.prepare(`UPDATE flyvask_swap_state SET revision = CASE WHEN
        EXISTS (SELECT 1 FROM effective_user_permissions WHERE user_id = ? AND permission_key = 'flyvask.swap')
        AND (${predicate}) THEN revision + 1 ELSE -1 END WHERE id = 1`).bind(actor.id, ...values),
      db.prepare("DELETE FROM flyvask_swap_reservations WHERE request_id IN (SELECT id FROM flyvask_swap_requests WHERE status <> 'OPEN')"),
      ...writes,
    ]);
  } catch (cause) {
    if (cause instanceof Error && (cause.message.includes('flyvask_swap_guard') ||
        cause.message.includes('UNIQUE constraint failed: flyvask_swap_reservations') ||
        cause.message.includes('UNIQUE constraint failed: flyvask_swap_proposals'))) throw conflict();
    throw cause;
  }
}
const stamp = () => new Date().toISOString();
function event(db: D1Database, requestId: string, actor: ApplicationUser, type: string, now: string, proposalId: string | null = null) {
  return db.prepare('INSERT INTO flyvask_swap_events VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), requestId, actor.id, type, proposalId, now);
}
function reservation(db: D1Database, userId: string, shiftId: string, requestId: string, proposalId: string | null = null) {
  return db.prepare('INSERT INTO flyvask_swap_reservations VALUES (?, ?, ?, ?)').bind(userId, shiftId, requestId, proposalId);
}
export async function createExchange(db: D1Database, actor: ApplicationUser, shiftId: string, expected: { startsAt: string; endsAt: string }) {
  const now = stamp(), id = crypto.randomUUID();
  await transaction(db, actor, `EXISTS (SELECT 1 FROM flyvask_shifts s JOIN ${effectiveAssignments} a ON a.shift_id = s.id
    WHERE s.id = ? AND a.user_id = ? AND s.status = 'OPEN' AND s.starts_at > ? AND s.starts_at = ? AND s.ends_at = ?) AND ${freeShift}`,
    [shiftId, actor.id, now, expected.startsAt, expected.endsAt, actor.id, shiftId], [
      db.prepare(`INSERT INTO flyvask_swap_requests
        (id, requester_user_id, requested_shift_id, requested_starts_at, requested_ends_at, status, created_at, updated_at)
        SELECT ?, ?, id, starts_at, ends_at, 'OPEN', ?, ? FROM flyvask_shifts WHERE id = ?`)
        .bind(id, actor.id, now, now, shiftId),
      reservation(db, actor.id, shiftId, id), event(db, id, actor, 'REQUEST_CREATED', now),
    ]);
  return { id };
}
export async function createProposal(db: D1Database, actor: ApplicationUser, id: string, shiftId: string, expected: { startsAt: string; endsAt: string }) {
  const now = stamp(), proposalId = crypto.randomUUID();
  await transaction(db, actor, `EXISTS (SELECT 1 FROM flyvask_swap_requests r WHERE r.id = ?
    AND r.status = 'OPEN' AND ${requestedEligible} AND ${requestReservation} AND ${distinctIdentity} AND r.requested_shift_id <> ?
    AND (SELECT COUNT(*) FROM flyvask_swap_proposals WHERE request_id = r.id) < 50
    AND NOT EXISTS (SELECT 1 FROM flyvask_swap_proposals WHERE request_id = r.id AND proposer_user_id = ? AND status = 'OPEN')
    AND NOT EXISTS (SELECT 1 FROM ${effectiveAssignments} a JOIN users u ON u.id = a.user_id
      WHERE a.shift_id = r.requested_shift_id AND u.flightlogger_user_id = (SELECT flightlogger_user_id FROM users WHERE id = ?)))
    AND EXISTS (SELECT 1 FROM flyvask_shifts s JOIN ${effectiveAssignments} a ON a.shift_id = s.id
      WHERE s.id = ? AND a.user_id = ? AND s.status = 'OPEN' AND s.starts_at > ? AND s.starts_at = ? AND s.ends_at = ?)
    AND ${freeShift} AND ${noAssignment}`,
    [id, now, actor.id, shiftId, actor.id, actor.id, shiftId, actor.id, now, expected.startsAt, expected.endsAt, actor.id, shiftId, shiftId,
      // Requester must not already hold the offered assignment.
      // Its ID is loaded without exposing identities to the caller.
      await requesterId(db, id)], [
      db.prepare(`INSERT INTO flyvask_swap_proposals
        (id, request_id, proposer_user_id, offered_shift_id, offered_starts_at, offered_ends_at, status, created_at, updated_at)
        SELECT ?, ?, ?, id, starts_at, ends_at, 'OPEN', ?, ? FROM flyvask_shifts WHERE id = ?`)
        .bind(proposalId, id, actor.id, now, now, shiftId),
      reservation(db, actor.id, shiftId, id, proposalId), event(db, id, actor, 'PROPOSAL_CREATED', now, proposalId),
    ]);
  return { id: proposalId };
}
async function requesterId(db: D1Database, id: string) {
  return await db.prepare('SELECT requester_user_id FROM flyvask_swap_requests WHERE id = ?').bind(id).first<string>('requester_user_id') ?? '';
}
export async function acceptProposal(db: D1Database, actor: ApplicationUser, id: string, proposalId: string) {
  const now = stamp();
  await transaction(db, actor, `EXISTS (SELECT 1 FROM flyvask_swap_requests r JOIN flyvask_swap_proposals p ON p.request_id = r.id
    WHERE r.id = ? AND p.id = ? AND r.requester_user_id = ? AND r.status = 'OPEN' AND p.status = 'OPEN'
    AND ${requestedEligible} AND ${offeredEligible} AND ${requestReservation} AND ${proposalReservation}
    AND p.offered_shift_id <> r.requested_shift_id
    AND EXISTS (SELECT 1 FROM users u JOIN users v ON v.id = p.proposer_user_id WHERE u.id = r.requester_user_id
      AND u.flightlogger_user_id <> v.flightlogger_user_id)
    AND NOT EXISTS (SELECT 1 FROM ${activeReservations} WHERE user_id = r.requester_user_id AND shift_id = p.offered_shift_id)
    AND NOT EXISTS (SELECT 1 FROM ${activeReservations} WHERE user_id = p.proposer_user_id AND shift_id = r.requested_shift_id)
    AND NOT EXISTS (SELECT 1 FROM ${effectiveAssignments} a JOIN users u ON u.id = a.user_id WHERE
      (a.shift_id = p.offered_shift_id AND u.flightlogger_user_id = (SELECT flightlogger_user_id FROM users WHERE id = r.requester_user_id)) OR
      (a.shift_id = r.requested_shift_id AND u.flightlogger_user_id = (SELECT flightlogger_user_id FROM users WHERE id = p.proposer_user_id))))`,
    [id, proposalId, actor.id, now, now], [
      db.prepare(`UPDATE flyvask_swap_requests SET status = 'ACCEPTED', accepted_by_user_id =
        (SELECT proposer_user_id FROM flyvask_swap_proposals WHERE id = ?), accepted_proposal_id = ?, accepted_at = ${acceptedTimestamp}, updated_at = ?
        WHERE id = ? AND status = 'OPEN'`).bind(proposalId, proposalId, now, now, id),
      db.prepare(`UPDATE flyvask_swap_proposals SET status = CASE WHEN id = ? THEN 'ACCEPTED' ELSE 'NOT_SELECTED' END,
        updated_at = ? WHERE request_id = ? AND status = 'OPEN'`).bind(proposalId, now, id),
      db.prepare('DELETE FROM flyvask_swap_reservations WHERE request_id = ?').bind(id),
      event(db, id, actor, 'PROPOSAL_ACCEPTED', now, proposalId),
    ]);
  return { id };
}
export async function cancelExchange(db: D1Database, actor: ApplicationUser, id: string) {
  const now = stamp();
  await transaction(db, actor, `EXISTS (SELECT 1 FROM flyvask_swap_requests WHERE id = ? AND requester_user_id = ? AND status = 'OPEN')`, [id, actor.id], [
    db.prepare(`UPDATE flyvask_swap_requests SET status = 'CANCELLED', cancelled_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, id),
    db.prepare(`UPDATE flyvask_swap_proposals SET status = 'NOT_SELECTED', updated_at = ? WHERE request_id = ? AND status = 'OPEN'`).bind(now, id),
    db.prepare('DELETE FROM flyvask_swap_reservations WHERE request_id = ?').bind(id), event(db, id, actor, 'REQUEST_CANCELLED', now),
  ]);
  return { id };
}
export async function withdrawProposal(db: D1Database, actor: ApplicationUser, id: string, proposalId: string) {
  const now = stamp();
  await transaction(db, actor, `EXISTS (SELECT 1 FROM flyvask_swap_proposals p JOIN flyvask_swap_requests r ON r.id = p.request_id
    WHERE p.id = ? AND r.id = ? AND p.proposer_user_id = ? AND p.status = 'OPEN' AND r.status = 'OPEN')`, [proposalId, id, actor.id], [
    db.prepare(`UPDATE flyvask_swap_proposals SET status = 'WITHDRAWN', updated_at = ? WHERE id = ?`).bind(now, proposalId),
    db.prepare('DELETE FROM flyvask_swap_reservations WHERE proposal_id = ?').bind(proposalId),
    event(db, id, actor, 'PROPOSAL_WITHDRAWN', now, proposalId),
  ]);
  return { id: proposalId };
}

export async function listExchanges(db: D1Database, actor: ApplicationUser, cursor: string | null = null): Promise<ExchangesResponse> {
  const now = stamp();
  let before = '9999', beforeId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  if (cursor) {
    const parts = cursor.split('|');
    if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parts[0]) || !Number.isFinite(Date.parse(parts[0]))) {
      throw new ApplicationError('Use a valid exchange cursor.', 400);
    }
    before = parts[0]; beforeId = exchangeId(parts[1]);
  }
  const requests = await db.prepare(`SELECT r.*, u.flightlogger_first_name AS first_name, u.flightlogger_last_name AS last_name,
    v.flightlogger_first_name AS accepted_first_name, v.flightlogger_last_name AS accepted_last_name,
    ${requestedEligible} AND ${requestReservation} AS eligible
    FROM flyvask_swap_requests r JOIN users u ON u.id = r.requester_user_id LEFT JOIN users v ON v.id = r.accepted_by_user_id
    WHERE r.status = 'OPEN' AND (r.requester_user_id = ? OR r.accepted_by_user_id = ? OR
      EXISTS (SELECT 1 FROM flyvask_swap_proposals p WHERE p.request_id = r.id AND p.proposer_user_id = ? AND p.status = 'OPEN') OR
      (r.status = 'OPEN' AND ${requestedEligible} AND ${requestReservation}))
    AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?)) ORDER BY r.created_at DESC, r.id DESC LIMIT 31`)
    .bind(now, actor.id, actor.id, actor.id, now, before, before, beforeId).all<Record<string, unknown>>();
  const page = requests.results.slice(0, 30);
  const result = await db.batch([
    db.prepare(`SELECT p.*, u.flightlogger_first_name AS first_name, u.flightlogger_last_name AS last_name,
      ${offeredEligible} AND ${proposalReservation} AS eligible FROM flyvask_swap_proposals p
      JOIN users u ON u.id = p.proposer_user_id JOIN flyvask_swap_requests r ON r.id = p.request_id
      WHERE p.status = 'OPEN' AND p.request_id IN (SELECT value FROM json_each(?)) AND (r.requester_user_id = ? OR p.proposer_user_id = ?)
      ORDER BY p.created_at, p.id`).bind(now, JSON.stringify(page.map(r => r.id)), actor.id, actor.id),
    db.prepare(`SELECT l.shift_id FROM ${activeReservations} l JOIN flyvask_shifts s ON s.id = l.shift_id
      WHERE l.user_id = ? AND s.ends_at > ?`).bind(actor.id, now),
  ]);
  const person = (id: unknown, first: unknown, last: unknown) => ({ id: id as string, firstName: first as string | null, lastName: last as string | null });
  const proposals = result[0].results as Record<string, unknown>[];
  const normalized: ExchangeRequest[] = page.map(r => ({ id: r.id as string, type: 'DIRECT_SWAP', status: r.status as RequestStatus,
    requester: person(r.requester_user_id, r.first_name, r.last_name), requestedShift: { id: r.requested_shift_id as string | null, startsAt: r.requested_starts_at as string, endsAt: r.requested_ends_at as string },
    acceptedBy: r.accepted_by_user_id ? person(r.accepted_by_user_id, r.accepted_first_name, r.accepted_last_name) : null,
    acceptedProposalId: r.accepted_proposal_id as string | null, createdAt: r.created_at as string, acceptedAt: r.accepted_at as string | null, eligible: !!r.eligible,
    proposals: proposals.filter(p => p.request_id === r.id).map(p => ({ id: p.id as string, status: p.status as ProposalStatus,
      proposer: person(p.proposer_user_id, p.first_name, p.last_name), offeredShift: { id: p.offered_shift_id as string | null, startsAt: p.offered_starts_at as string, endsAt: p.offered_ends_at as string },
      createdAt: p.created_at as string, eligible: !!p.eligible } satisfies ExchangeProposal)) }));
  const last = page.at(-1);
  return { currentUserId: actor.id, requests: normalized, lockedShiftIds: (result[1].results as { shift_id: string }[]).map(r => r.shift_id),
    nextCursor: requests.results.length > 30 && last ? `${last.created_at}|${last.id}` : null };
}
