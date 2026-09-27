# Duty Ops exchanges, effective assignments and history

## Two assignment sources

`duty_ops_assignments` is exclusively the latest synchronized **FlightLogger snapshot**. Portal operations never insert, delete or rewrite it. FlightLogger remains read-only.

**Studentportal effective assignments** are the primary operational view for Today, Schedule, My shifts, Home personal relevance and all exchange eligibility checks. Accepted portal agreements transfer individual `(student, shift)` memberships, not whole shifts. Other students on the same shift are unaffected.

Unchanged participant lists show one compact list with a FlightLogger source label. Changed lists show Studentportal first and FlightLogger beneath it. Unknown/masked participants retain the existing count/others presentation; identities and emails are never inferred from masked slots. Portal transfers do not alter the FlightLogger participant count or schedule entry.

## Give away and direct swap

- **Give away:** publish an OPEN request for your effective membership. Publishing is consent; the first eligible other student claims it immediately. There is no second owner confirmation.
- **Direct swap:** publish an OPEN request. Other students independently offer one of their effective memberships. You choose one offer after confirming both shifts. The chosen offer is ACCEPTED and all other OPEN offers become NOT_SELECTED atomically. The proposer does not confirm again.
- Requests: `OPEN -> ACCEPTED` or `OPEN -> CANCELLED`.
- Proposals: `OPEN -> ACCEPTED`, `WITHDRAWN`, or `NOT_SELECTED`.
- Accepted agreements are immutable through normal student operations. Cancellation and withdrawal apply only to OPEN operations.

Only future, OPEN shifts with unchanged consent times can be exchanged. Lost effective membership, cancellation, completion, a started shift or rescheduling invalidates consent. The backend rechecks these rules inside the write transaction.

An acquired membership is immediately available for another give-away, request or proposal. For example, `Simon -> Erik -> Lisa` leaves Lisa effectively assigned while preserving two separate accepted agreements. Direct and mixed chains work the same way, including transfer back to a previous holder.

## One authoritative overlay

Additive migration `0006_duty_ops_effective_assignments.sql` defines:

| View/index | Purpose |
| --- | --- |
| `duty_ops_assignment_effects` | Removal/addition effects of accepted give-aways and both legs of direct swaps |
| `duty_ops_effective_assignments` | Raw memberships untouched by agreements plus the latest accepted effect for each touched membership |
| `duty_ops_active_swap_reservations` | Reservations for OPEN requests and OPEN proposals only |
| Accepted request index | Acceptance ordering and history lookup |

Effects are ordered by `(accepted_at, request_id)`. The last effect on a membership wins. New acceptances allocate a strictly increasing millisecond timestamp inside the same D1 transaction; this preserves actual chain order even for simultaneous requests and one clock tick. Existing historical ties use stable request IDs.

The SQL view is shared by mutation guards and the central `backend/duty-ops/effective-assignments.ts` read service. The frontend receives effective participants/count as the primary fields, a separate `flightlogger` participant snapshot and `assignmentsDiffer`. It never reconstructs swaps independently. Raw and effective participant lists are read together in a transactional D1 batch. Multiple Access subjects sharing a known FlightLogger identity count as one participant; transfer effects suppress raw aliases of a former holder.

### FlightLogger catch-up and reconciliation

Replaying effects is **idempotent**: accepted removals remain absent and accepted additions remain present. Replaying a complete chain over its original, intermediate or final FlightLogger snapshot therefore produces the same final portal memberships. Direct swaps follow the same rule. A synchronized unrelated participant continues to follow the raw snapshot.

For memberships touched by accepted agreements, the latest portal effect remains authoritative even if a later FlightLogger edit disagrees. There is no automatic inference that an external change revokes student consent, and no automatic reconciliation/APPLIED workflow in this phase. This deliberate policy avoids double application, resurrected previous holders and broken chains. Future external-write/reconciliation work must introduce an explicit audited policy rather than deleting history.

The count remains based on source participant slots (at least the number of known effective participants). Partial cross-account sync may still give an incomplete source list; unknown slots are never mapped to guessed identities.

### Upgrade and reservations

Migrations 0004 and 0005 are unchanged. Existing accepted agreements immediately participate in the derived overlay; no backfill or collapsed transfer history is needed. Valid OPEN requests/proposals remain intact.

Migration-before-deployment must remain safe for the old v1 application. Consequently 0006 **does not physically delete accepted v1 reservation rows during migration**: those are compatibility rows that keep v1's existing protection until the new code deploys. The new active-reservation view excludes them immediately. The first successful v2 mutation deletes legacy closed-request reservations within its permission/eligibility-guarded batch before making any new reservations. A failure rolls back cleanup as well. New acceptances delete all reservations for that request. Accepted rows therefore never permanently lock a received membership in v2.

Reservations protect active intent only. Cancellation, withdrawal and selection release the appropriate locks. No history is changed to enable chaining.

## Transactions, authorization and freshness

All mutations require `duty_ops.swap`, rechecked in the D1 transaction against the existing effective permission resolver. Listing and personal history require `duty_ops.view`, including students whose swap permission was subsequently removed. Role defaults are unchanged. Frontend controls are UX, not authorization.

A D1 batch contains the permission/eligibility guard, legacy lock cleanup, state transition, reservation updates and audit insert. Losing claims, stale ownership and failed audits abort the entire batch. Exactly one concurrent give-away claim or direct-swap selection can succeed. The effective overlay changes atomically when acceptance commits; raw snapshots remain untouched.

Before consent operations, only the actor's encrypted FlightLogger credential is decrypted. Existing five-minute synchronization and stale-refresh rejection remain; cancellation/withdrawal and history need no upstream credential. No cross-account FlightLogger calls are added. Other students' raw data remains a synchronized snapshot, not a real-time promise. The actor's sync can change raw data normally without destroying accepted effects.

Requests use bounded strict JSON, parameterized SQL, existing same-origin/CSRF protection and `Cache-Control: no-store`. Audit events remain REQUEST_CREATED, REQUEST_CANCELLED, GIVE_AWAY_CLAIMED, PROPOSAL_CREATED, PROPOSAL_WITHDRAWN and PROPOSAL_ACCEPTED. No credentials or arbitrary bodies are recorded.

## Active workspace and personal history

`/duty-ops` has compact secondary navigation: **Overview / Swap history**. Its Shift exchange section is active work only: OPEN requests and permitted OPEN proposals. Accepted, cancelled, withdrawn and not-selected activity does not clutter it. Invalid OPEN requests/offers remain manageable by their owners, with an ineligible label and cancellation/withdrawal.

`/duty-ops/swap-history` is a bookmarkable personal view of accepted agreements. Give-aways say Gave shift to / Took shift from. Direct swaps show You gave / You received from the viewing student's perspective. Each chain link stays a separate entry. Acceptance and shift times use Europe/Oslo and semantic time elements. Student is the fallback for missing trusted stored names.

History is returned only when the authenticated user is requester or accepted recipient. Unselected proposers cannot read the completed agreement as their own history. No user selector or email is exposed. Consent times remain displayable when either source shift foreign key becomes NULL after discovery removes a booking.

## API

Base `/api/duty-ops/swaps`:

| Endpoint | Result/body |
| --- | --- |
| `GET /` | Active requests, permitted OPEN proposals, active locked shift IDs; creation-time/ID keyset pages |
| `GET /history` | Personal accepted entries with counterparty, givenShift/receivedShift and acceptedAt; newest acceptance-time/ID first |
| `POST /` | `{type: "GIVE_AWAY" or "DIRECT_SWAP", shiftId, startsAt, endsAt}` |
| `POST /:requestId/claim` | `{}` |
| `POST /:requestId/cancel` | `{}` |
| `POST /:requestId/proposals` | `{shiftId, startsAt, endsAt}` |
| `POST /:requestId/proposals/:proposalId/accept` | `{}` |
| `POST /:requestId/proposals/:proposalId/withdraw` | `{}` |

Lists use 30-item pages, optional `?cursor=...`, and `nextCursor`. Proposals remain bounded at 50 total per request. History uses stored consent timestamps, not live source metadata. Stale/losing mutations return safe 409 EXCHANGE_CONFLICT; permission denial returns 403 FORBIDDEN.

## Migration and verification

Normal develop/master releases use the ordered [database and deployment automation](database-updates.md): validate/build, migrate the matching database, then deploy the same commit. Do not manually apply 0006 to production or bypass the release workflow.

For local development only, from the repository root:

```powershell
npm run db:migrate:local
npm run check
npm test
npm --prefix frontend test
npm --prefix frontend run build
npm run functions:build
```

Tests include populated v1 upgrade, chains/catch-up, multi-person memberships, concurrent claims/selections, audit rollback, unchanged raw snapshots, permission/CSRF handling, personal history pagination/privacy/deleted shifts and effective Duty Ops/Home presentation. Browser verification covers desktop, narrow laptop and phone widths without horizontal overflow.

Future work may add explicit APPLIED/reconciliation state and FlightLogger mutations, with a separate consent/audit design. This phase adds no writes to FlightLogger, notifications, scheduling, admin approval, credit or recommendation system.
