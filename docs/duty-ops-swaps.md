# Duty Ops shift exchange

Portal exchanges record student consent. FlightLogger remains read-only, and `duty_ops_assignments` remains its synchronized assignment snapshot. **Accepted means agreed in Studentportal, not applied to FlightLogger.** The normal Today/My shifts/Schedule view is unchanged by agreements.

## Flows and states

- **Give away:** owner publishes an OPEN request. Publishing constitutes consent. The first eligible other student to claim it changes it to ACCEPTED immediately; the owner does not confirm again.
- **Direct swap:** owner publishes an OPEN request. Different students can each offer their own shift. The owner chooses one proposal after seeing both shifts. That proposal becomes ACCEPTED; all other OPEN proposals become NOT_SELECTED in the same transaction. The proposer does not confirm again.
- Requests: `OPEN → ACCEPTED` or `OPEN → CANCELLED`.
- Proposals: `OPEN → ACCEPTED`, `WITHDRAWN`, or `NOT_SELECTED`. Withdrawn proposals remain in history. Cancellation closes open proposals as NOT_SELECTED.
- Owners can cancel OPEN requests; proposers can withdraw their own OPEN proposals. Accepted agreements cannot be cancelled/changed through student endpoints.

Only future, OPEN source shifts are exchangeable. Cancelled/completed/in-progress shifts, lost assignments and changed times invalidate consent. Creation/proposals include the displayed timestamps; the transaction checks they still match the source. Acceptance checks both stored timestamp snapshots against the current source shifts.

## Database

New additive migration: `migrations/0004_duty_ops_swaps.sql`. Earlier migrations are unchanged.

| Table | Purpose |
| --- | --- |
| `duty_ops_swap_requests` | Requester, source shift, type/status, acceptance/cancellation timestamps and accepted proposal/recipient |
| `duty_ops_swap_proposals` | Proposer, offered shift, status/timestamps; at most one OPEN proposal per user/request |
| `duty_ops_swap_events` | Actor, request, optional proposal, event type and timestamp |
| `duty_ops_swap_reservations` | Unique user/shift reservation preventing incompatible open offers and unapplied agreements |
| `duty_ops_swap_state` | Transaction guard with a named CHECK constraint |

Open proposals reserve the offered assignment, so it cannot also be published/offered elsewhere. Cancellation/withdrawal release reservations; selecting a proposal releases losing reservations. Accepted agreements retain reservations on offered and incoming shifts, preventing chains of unapplied exchanges in v1. They are not new assignments.

Requests/proposals store consent timestamps separately. Shift foreign keys use `ON DELETE SET NULL`, preserving agreement dates and audit history when normal FlightLogger discovery removes a booking. Reservations cascade on shift deletion. Users referenced by history cannot be deleted without a deliberate later retention/migration policy; there is no account-deletion UI in this phase.

## Atomicity and authorization

Every mutation requires `duty_ops.swap`. The existing role defaults are unchanged. `duty_ops.view` permits listing and the normal Duty Ops page; exchange controls appear only with swap permission. Frontend checks are UX, not authorization.

A D1 `batch` runs the permission/eligibility guard, state transition, reservation updates and audit insert in one transaction. The guard rechecks permissions and assignment ownership inside the transaction. Its named CHECK constraint aborts the whole batch on a losing claim or changed state. Database uniqueness enforces reservations/open proposal constraints. Thus simultaneous claims/selections yield exactly one successful acceptance. An audit failure also rolls back acceptance. See [D1 transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

All writes use strict, bounded JSON bodies, resource IDs, the existing same-origin Origin/Fetch Metadata protection, safe errors and `Cache-Control: no-store`. No credentials, emails, JWTs, FlightLogger booking IDs or raw GraphQL are returned. Names come from trusted existing self-query fields, with `Student` as fallback. Proposal lists are visible to the request owner; other students see only their own proposals.

Events: `REQUEST_CREATED`, `REQUEST_CANCELLED`, `GIVE_AWAY_CLAIMED`, `PROPOSAL_CREATED`, `PROPOSAL_WITHDRAWN`, `PROPOSAL_ACCEPTED`. There is no student-facing event-history API yet.

## API

Base: `/api/duty-ops/swaps`. All mutations use POST; GET never changes state.

| Route | Body / result |
| --- | --- |
| `GET /` | Relevant OPEN requests, own history/agreements/offers, permitted proposals, current user ID and reserved shift IDs |
| `POST /` | `{type: "GIVE_AWAY" \| "DIRECT_SWAP", shiftId, startsAt, endsAt}` → `{id}`, 201 |
| `POST /:requestId/claim` | `{}` → `{id}` |
| `POST /:requestId/cancel` | `{}` → `{id}` |
| `POST /:requestId/proposals` | `{shiftId, startsAt, endsAt}` → proposal `{id}`, 201 |
| `POST /:requestId/proposals/:proposalId/accept` | `{}` → request `{id}` |
| `POST /:requestId/proposals/:proposalId/withdraw` | `{}` → proposal `{id}` |

Listing uses 30-item keyset pages ordered by creation time/ID, with `nextCursor` and optional `?cursor=...`; the UI has Load more. Requests have at most 50 total proposals, including withdrawn history, to bound response/transaction size. Cross-user closed histories are not public. A changed state returns safe 409 `EXCHANGE_CONFLICT`; permission denial returns 403 `FORBIDDEN`.

## Snapshot freshness limitation

Before creating, claiming, proposing or accepting, the backend decrypts **only the authenticated actor's credential** and reuses normal Duty Ops synchronization with its five-minute TTL. It requires fresh discovery and actor assignment metadata and limits consent actions to the current default Duty Ops window. Stale refresh results fail closed; existing agreements are left intact. Cancellation/withdrawal do not require FlightLogger connectivity.

Consent requests allow at most 15 FlightLogger calls, leaving Workers Free subrequest headroom for Access, D1 checks and the exchange transaction. Large upstream pages fail safely rather than truncating. Ordinary read-only Duty Ops retains its existing 30-call budget.

The other student's ownership is checked against their current **portal snapshot** inside the transaction. Their credential is never decrypted or fetched for this purpose. This is not real-time cross-account validation; changes within the TTL or before another student's next sync can remain unseen. The agreement must still be applied separately in FlightLogger. A future deliberate integration can add APPLIED/reconciliation state and release accepted reservations; it must retain consent history and must not rewrite source snapshots to simulate an external update.

## Local and preview setup

No production migration, binding, secret or deployment is performed by this feature. Run from the `feature/duty-ops-swaps` checkout:

```powershell
# Isolated local database
npm run db:migrate:local
npm run db:status:local

# Preview only, after reviewing the target studentportal-preview
npx wrangler d1 migrations apply DB --remote --env preview --config wrangler.jsonc
npx wrangler d1 migrations list DB --remote --env preview --config wrangler.jsonc
```

Apply all migrations through 0004 before testing the new Functions. Keep the existing preview DB/KV/Access/encryption setup; no new secret is needed. Use preview administrator permissions to grant `duty_ops.swap` to test students. Do not change STUDENT defaults. Test with two authorized accounts/personal keys; verify the actor names, one-click claim, multi-proposal choice, accepted labels and unchanged FlightLogger schedule. Then review the PR into **develop**. Production/master release is a separate decision.

## Scope

No FlightLogger mutations, automatic application, admin approval, IOUs, scoring/recommendations, notifications/push, scheduled jobs, scheduler, fuel or transport integration. Browser/CI use synthetic data and disposable D1; live multi-account staging validation remains necessary.
