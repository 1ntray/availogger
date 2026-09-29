import { ApplicationError } from '../application-error';
import type { ApplicationUser } from '../users';
import type { CreditSummary, CreditsResponse, CreditStandingsResponse } from '../../shared/duty-ops-credits';

export const creditBalances = 'duty_ops_credit_balances';
export const creditAboveFloor = (userExpression: string) => `COALESCE((SELECT balance FROM ${creditBalances} WHERE user_id = ${userExpression}), 0) > -2`;
// The two-party source is defined once in SQL. One statement reconciles old code
// acceptances made after migration but before deployment, without duplicate entries.
export function reconcileCoverageStatement(db: D1Database) {
  return db.prepare(`INSERT INTO duty_ops_credit_transactions SELECT e.* FROM duty_ops_credit_coverage_entries e
    WHERE NOT EXISTS (SELECT 1 FROM duty_ops_credit_transactions t WHERE t.exchange_request_id = e.exchange_request_id AND t.user_id = e.user_id)`);
}
export async function reconcileCoverage(db: D1Database) { await reconcileCoverageStatement(db).run(); }
export async function creditSummary(db: D1Database, actor: Pick<ApplicationUser, 'id'>): Promise<CreditSummary> {
  const row = await db.prepare(`SELECT balance, covered_count, received_count FROM ${creditBalances} WHERE user_id = ?`)
    .bind(actor.id).first<{ balance: number; covered_count: number; received_count: number }>();
  return { balance: row?.balance ?? 0, coveredCount: row?.covered_count ?? 0, receivedCount: row?.received_count ?? 0 };
}
export function coverageTransfer(db: D1Database, requestId: string) {
  return db.prepare(`INSERT INTO duty_ops_credit_transactions SELECT * FROM duty_ops_credit_coverage_entries WHERE exchange_request_id = ?`).bind(requestId);
}
export async function listCredits(db: D1Database, actor: ApplicationUser, cursor: string | null): Promise<CreditsResponse> {
  let before = '9999', beforeId = 'ffffffff-ffff-ffff-ffff-ffffffffffff:requester';
  if (cursor) {
    const parts = cursor.split('|');
    if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parts[0]) ||
      !Number.isFinite(Date.parse(parts[0])) || new Date(parts[0]).toISOString() !== parts[0] ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(claimant|requester)$/i.test(parts[1])) {
      throw new ApplicationError('Use a valid credit history cursor.', 400, 'INVALID_CREDIT_REQUEST');
    }
    [before, beforeId] = parts;
  }
  await reconcileCoverage(db);
  const hasV2 = !!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='exchange_v2_credit_entries'").first();
  const history = `WITH history AS (
    SELECT t.id,t.user_id,t.amount,t.exchange_request_id,t.created_at,t.counterparty_user_id,
      r.requested_shift_id,r.requested_starts_at,r.requested_ends_at
    FROM duty_ops_credit_transactions t JOIN duty_ops_swap_requests r ON r.id=t.exchange_request_id
    ${hasV2 ? `UNION ALL
    SELECT e.candidate_id||':'||CASE WHEN e.amount<0 THEN 'requester' ELSE 'claimant' END,
      e.user_id,e.amount,e.candidate_id,e.created_at,other.user_id,
      json_extract(CASE WHEN e.amount<0 THEN leg.give_snapshot ELSE leg.receive_snapshot END,'$.id'),
      json_extract(CASE WHEN e.amount<0 THEN leg.give_snapshot ELSE leg.receive_snapshot END,'$.startsAt'),
      json_extract(CASE WHEN e.amount<0 THEN leg.give_snapshot ELSE leg.receive_snapshot END,'$.endsAt')
    FROM exchange_v2_credit_entries e
    JOIN exchange_v2_credit_entries other ON other.candidate_id=e.candidate_id AND other.amount=-e.amount
    JOIN exchange_v2_candidate_legs leg ON leg.candidate_id=e.candidate_id AND leg.user_id=e.user_id` : ''}
  ) SELECT h.*,u.flightlogger_first_name,u.flightlogger_last_name FROM history h
    JOIN users u ON u.id=h.counterparty_user_id
    WHERE h.user_id=? AND (h.created_at<? OR (h.created_at=? AND h.id<?))
    ORDER BY h.created_at DESC,h.id DESC LIMIT 31`;
  const results = await db.batch([
    db.prepare(`SELECT balance, covered_count, received_count FROM ${creditBalances} WHERE user_id = ?`).bind(actor.id),
    db.prepare(history).bind(actor.id, before, before, beforeId),
  ]);
  const stats = results[0].results[0] as { balance: number; covered_count: number; received_count: number } | undefined;
  const page = results[1].results.slice(0, 30) as Record<string, unknown>[];
  const last = page.at(-1);
  return { balance: stats?.balance ?? 0, coveredCount: stats?.covered_count ?? 0, receivedCount: stats?.received_count ?? 0,
    entries: page.map(row => ({ id: row.id as string, amount: row.amount as -1 | 1, reason: 'DUTY_OPS_COVERAGE', exchangeRequestId: row.exchange_request_id as string,
      counterparty: { id: row.counterparty_user_id as string, firstName: row.flightlogger_first_name as string | null, lastName: row.flightlogger_last_name as string | null },
      shift: { id: row.requested_shift_id as string | null, startsAt: row.requested_starts_at as string, endsAt: row.requested_ends_at as string }, createdAt: row.created_at as string })),
    nextCursor: results[1].results.length > 30 && last ? `${last.created_at}|${last.id}` : null };
}
export async function creditStandings(db: D1Database): Promise<CreditStandingsResponse> {
  await reconcileCoverage(db);
  const roster = `WITH population AS (SELECT u.id, u.flightlogger_first_name, u.flightlogger_last_name,
    COALESCE(NULLIF(TRIM(COALESCE(u.flightlogger_first_name, '') || ' ' || COALESCE(u.flightlogger_last_name, '')), ''), 'Student') AS display_name,
    b.balance, b.covered_count, b.received_count,
    ROW_NUMBER() OVER (PARTITION BY b.identity ORDER BY
      CASE WHEN NULLIF(TRIM(COALESCE(u.flightlogger_first_name, '') || COALESCE(u.flightlogger_last_name, '')), '') IS NULL THEN 1 ELSE 0 END, u.id) AS position
    FROM users u JOIN ${creditBalances} b ON b.user_id = u.id
    WHERE EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.key = 'STUDENT'))
    SELECT id, flightlogger_first_name, flightlogger_last_name, balance, covered_count, received_count FROM population WHERE position = 1`;
  const [top, all] = await db.batch<Record<string, unknown>>([
    db.prepare(`${roster} ORDER BY balance DESC, covered_count DESC, display_name COLLATE NOCASE, id LIMIT 10`),
    db.prepare(`${roster} ORDER BY display_name COLLATE NOCASE, id`),
  ]);
  const normalize = (rows: Record<string, unknown>[]) => rows.map(row => ({ student: { id: row.id as string,
    firstName: row.flightlogger_first_name as string | null, lastName: row.flightlogger_last_name as string | null },
    balance: row.balance as number, coveredCount: row.covered_count as number, receivedCount: row.received_count as number }));
  return { topContributors: normalize(top.results), students: normalize(all.results) };
}
