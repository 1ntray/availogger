# Duty Ops and Flyvask assignment reconciliation

FlightLogger remains read-only. Global `all:true` discovery provides the authoritative `participant_count` for each booking and deliberately discards participant identities. Individual `all:false` syncs add or remove only that student's known raw membership. Those identity rows may be incomplete or stale; a count reduction alone never deletes one.

An accepted Studentportal exchange replaces an existing assignment slot. It does not add a participant. Migration `0016_assignment_reconciliation.sql` records the replaced and replacement identities, source request/candidate and acceptance order. It backfills accepted v1 requests and v2 candidate effects without editing the accepted history. The backfill marks identity links as `BACKFILLED`: older rows prove the user-to-user transfer, while the linked FlightLogger identities are the best available values at migration time, not proven historical snapshots. Equal-time related backfill transfers whose order cannot be established are flagged as unverified rather than displayed as a guessed holder. Future acceptances capture identities and sequence in the same D1 transaction. A transfer chain such as A → B → C has one final portal holder, C. The old membership-effect tables remain factual history but are no longer replayed as independent additions to the effective roster.

The three-way model is:

| Base holder | Accepted portal result | Current FlightLogger holder | Studentportal result |
| --- | --- | --- | --- |
| A | B | A | B, normal portal override |
| A | B | B | B, converged |
| A | B | C | B, source divergence conflict |

With independent slots D and E, the last row means **B, D, E** occupy three portal slots, while FlightLogger reports **C, D, E**. When the cached identities do not prove which raw person occupies the disputed slot, the API returns only the known-safe portal holder and the authoritative total (for example, “B · 2 others”), with a conflict message. It never renders B and C as a fourth slot. If cached raw identities exceed the global count, all ambiguous raw names are withheld; no identity is guessed or deleted. Normal self-sync can eventually clear stale rows. Convergence to B clears the conflict automatically.

`participantIntegrity` describes `CONSISTENT`, normal `PARTIAL` identity coverage, or `CONFLICT` with a machine-readable reason. `assignmentsDiffer` separately reports whether an accepted portal agreement intentionally differs from the known FlightLogger membership. `isCurrentUserAssigned` comes from the effective portal assignment and preserves the receiver's My upcoming/shift detail access during a conflict. `participantCount` always remains the global FlightLogger count.

The effective-assignment views expose only safe memberships. Internal candidate views keep the lightweight raw-plus-transfer projection needed by guarded exchange queries; they are not user-facing and must be paired with the reconciliation integrity check before any exchange mutation.

Conflicted Duty Ops/Flyvask shifts cannot start or complete another v1/v2 exchange. The server checks integrity again in the atomic mutation guard; a stale v2 action receives HTTP 409 `EXCHANGE_ASSIGNMENT_SYNC_CONFLICT`. Open intent and proposal history is retained for cancellation, withdrawal and later recovery. Accepted history, credits, raw assignments and FlightLogger are not rewritten by reconciliation. Brakkevakt uses its own published roster and is unaffected.

Server diagnostics log the domain, assignment ID, global count, known identity count, portal slot count and reason. They do not log credentials or Access tokens. Operationally, investigate the raw self-sync snapshots and accepted transfer chain; do not force a name from the global query or mark a discrepancy as resolved without a new trusted observation.
