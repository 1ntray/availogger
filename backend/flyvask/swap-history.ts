import { ApplicationError } from '../application-error';
import type { ApplicationUser } from '../users';
import type { ExchangeHistoryResponse } from '../../shared/flyvask-swaps';
import { exchangeId } from './swaps';

export async function listSwapHistory(db: D1Database, actor: ApplicationUser, cursor: string | null): Promise<ExchangeHistoryResponse> {
  let before = '9999', beforeId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  if (cursor) {
    const parts = cursor.split('|');
    if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parts[0]) ||
        !Number.isFinite(Date.parse(parts[0])) || new Date(parts[0]).toISOString() !== parts[0]) {
      throw new ApplicationError('Use a valid history cursor.', 400);
    }
    before = parts[0]; beforeId = exchangeId(parts[1]);
  }
  const { results } = await db.prepare(`SELECT r.*, p.offered_shift_id, p.offered_starts_at, p.offered_ends_at,
    u.id AS counterparty_id, u.flightlogger_first_name AS first_name, u.flightlogger_last_name AS last_name
    FROM flyvask_swap_requests r LEFT JOIN flyvask_swap_proposals p ON p.id = r.accepted_proposal_id
    JOIN users u ON u.id = CASE WHEN r.requester_user_id = ? THEN r.accepted_by_user_id ELSE r.requester_user_id END
    WHERE r.status = 'ACCEPTED' AND (r.requester_user_id = ? OR r.accepted_by_user_id = ?)
    AND (r.accepted_at < ? OR (r.accepted_at = ? AND r.id < ?))
    ORDER BY r.accepted_at DESC, r.id DESC LIMIT 31`).bind(actor.id, actor.id, actor.id, before, before, beforeId).all<Record<string, unknown>>();
  const page = results.slice(0, 30);
  const entries = page.map(r => {
    const requested = { id: r.requested_shift_id as string | null, startsAt: r.requested_starts_at as string, endsAt: r.requested_ends_at as string };
    const offered = { id: r.offered_shift_id as string | null, startsAt: r.offered_starts_at as string, endsAt: r.offered_ends_at as string };
    const own = r.requester_user_id === actor.id;
    return { id: r.id as string, type: 'DIRECT_SWAP' as const, acceptedAt: r.accepted_at as string,
      counterparty: { id: r.counterparty_id as string, firstName: r.first_name as string | null, lastName: r.last_name as string | null },
      givenShift: own ? requested : offered, receivedShift: own ? offered : requested };
  });
  const last = page.at(-1);
  return { entries, nextCursor: results.length > 30 && last ? `${last.accepted_at}|${last.id}` : null };
}
