# Duty Ops credits

Covering an accepted Duty Ops give-away earns the claimant **+1** and spends **-1** for the requester. Direct swaps and Flyvask have no credit effect. Publishing, proposing, cancelling and withdrawing do not transfer credits. Credits have no money value, expiry, penalty, manual transfer or administrator adjustment.

## Ledger and shared balance

Additive `0008_duty_ops_credits.sql` creates `duty_ops_credit_transactions`: immutable ID, user, integer amount (+1/-1), `DUTY_OPS_COVERAGE` reason, accepted exchange request, counterparty and acceptance timestamp. Foreign keys restrict removal of ledger parties/requests; update/delete triggers reject changes. The unique `(exchange_request_id, user_id)` prevents duplicate credit. Insert validation restricts entries to the accepted give-away's two parties, direction and timestamp. The application inserts both rows in one statement.

The SQL views `duty_ops_credit_accounts` / `duty_ops_credit_stats` / `duty_ops_credit_balances` define the single balance authority: SUM(amount), count of +1 rows (covered), count of -1 rows (received). There is no mutable balance column. Personal summaries, exchange eligibility/guards and public standings read this authority. As with effective assignments, accounts sharing the same trusted stored FlightLogger user ID share a logical balance; unlinked accounts use their application ID. No name/email matching is used. Public students are deduplicated by that identity, preferring a named Student account. A credential identity replacement changes that account's current identity grouping; its immutable ledger remains attached to its original application user.

## Floor and transaction

The minimum for new debit operations is -2. Both publishing a give-away and accepting one require the requester balance to be **above -2**, checked inside the guarded D1 batch. A requester at -1 may reach -2. A student at -2 or a historical lower balance can earn credits, use direct swaps, cancel requests and withdraw offers.

An existing open give-away remains OPEN at the floor. The owner sees the explanation; others see only generic unavailability, with no requester balance. Earning restores eligibility, subject to the existing ownership/time/reservation checks. No automatic cancellation occurs.

The give-away claim batch contains reconciliation, existing permission/ownership guard, credit-floor guard, acceptance/effective overlay, lock release, both ledger entries and audit. Both rows and the claim audit use the same stored `accepted_at`. A failed ledger, audit, reservation or guard aborts the whole batch. A losing concurrent claimant earns nothing; concurrent claims on different requests cannot spend the last available debit twice. The `duty_ops_credit_state.revision` is only a named CHECK transaction guard, never a stored balance. No floor trigger is placed on exchanges; old v2 application acceptance remains compatible during deployment.

## Backfill and release ordering

0008 follows merged Flyvask migration 0007; migrations 0001–0007 are unchanged. Its deterministic `duty_ops_credit_coverage_entries` view emits requester and claimant rows for historical ACCEPTED GIVE_AWAY requests, using their stored acceptance timestamps. The backfill inserts missing pairs atomically, is idempotent, is zero-sum, and excludes direct/open/cancelled requests. Historical balances below -2 are preserved.

Keep the existing ordered release pipeline: validate/build, apply migration to the matching database, deploy the same commit. During the migration-before-code window, old v2 can still accept give-aways. New credit reads and new give-away guard batches reconcile any missing legacy entries from that same deterministic source before using balances. This also covers old code retained after a deployment failure. Reconciliation is idempotent and does not rewrite exchange history or snapshots. No manual remote migration is part of this feature's implementation.

## UI, APIs and privacy

`/duty-ops` shows a compact clickable balance near the heading. Its secondary navigation is Overview / Swap history / Credits. Create/claim dialogs explain the consent-time predicted ±1 result; server checks remain authoritative. The give-away option and publish action are disabled at the floor; Look for swap stays available. Overview and credit summaries refresh every minute while visible and when returning to the page, with immediate refresh after exchanges.

`/duty-ops/credits` shows personal balance, shifts covered, shifts covered for you, private credit history, Top contributors and an alphabetical All balances roster. Positive values are signed; negatives use the same neutral styling. Contributors sort by balance descending, covered count descending, then display name and application ID. Only Student-role accounts appear, with trusted stored names and Student fallback.

| Endpoint | Response |
| --- | --- |
| `GET /api/duty-ops/credits` | Personal summary, 30 history entries, nextCursor |
| `GET /api/duty-ops/credits?cursor=...` | Older personal history ordered created_at DESC, id DESC |
| `GET /api/duty-ops/credits?summary=1` | Balance and two counts only |
| `GET /api/duty-ops/credits/standings` | Top 10 contributors and alphabetical Student balances |

Both endpoints require Cloudflare Access and `duty_ops.view`; no upstream credential is needed. History is restricted to the authenticated **application user**, with no user selector, including when aliases share aggregate statistics. Counters never expose another student's detailed transactions. Consent shift/acceptance times remain readable after live bookings disappear. Responses contain application IDs and stored names, never email, Access subject, JWT, credentials or raw FlightLogger identity. There is no credit write endpoint. Global sidebar/Home ordering is unchanged.

## Verification

Run `npm run db:migrate:local`, `npm run db:status:local`, `npm run check`, `npm test`, `npm --prefix frontend test`, `npm --prefix frontend run build`, and `npm run functions:build`.

Real D1 tests cover accepted transfers, idempotent historical/deployment-window backfill, legacy balances, both floor checks, restored open eligibility, same/different-request races, ledger/audit rollback, direct swaps/cancellation/withdrawal, Flyvask independence, alias identity, keyset pagination/deleted shifts and authorization/privacy. Frontend tests cover floor choices, debit/credit predictions, background balance refresh, private history pagination, signed neutral roster and safe API errors. Browser QA uses disposable loopback D1 and synthetic users to inspect desktop, narrow laptop and phone layouts and actual native dialogs.
