# Exchange v2 architecture

Exchange v2 is a portal agreement engine for Duty Ops, Flyvask and Brakkevakt. It does not write to FlightLogger. The effective assignment views (and the Brakkevakt published roster) remain the schedule authority. Existing accepted v1 agreements continue to affect the Duty Ops and Flyvask views; existing open v1 requests remain on their original API until resolved.

## Student UI

Exchange v2 is the default for **new** exchanges in all three modules. Own assignment rows open one intent with zero to ten selected targets; posting implicitly permits other eligible offers. Duty Ops may combine selected targets and `allowGiveAway` in the same intent. Flyvask and Brakkevakt have no give-away option. The creation dialog shows relevant existing exchanges first and can browse the normal schedule to select other targets.

An ordinary eligible assignment can show **Request swap**. The server supplies `REQUEST_SWAP` and `requestableSourceAssignmentIds`/`requestableSourceAssignments`; the student chooses one valid owned source, and the POST is revalidated by the server. After posting, the target row shows **Request sent**. The UI does not choose a named recipient: every eligible effective target member can review the assignment request. Rows and the Exchange Center consume canonical relationships, available actions and related IDs. An unselected offer or multi-way candidate shows each user's exact give/receive outcome; prior exact target consent is not requested again. Waiting candidates have no second accept action.

The domain pages show up to four concrete opportunities in one Exchanges preview before the full schedule. Inbox announces relevant new work, while the Exchange Center shows current processes. Active v1 requests and proposals remain manageable through their original APIs within the same user-facing Exchange surface; v1 locks do not expose conflicting v2 creation. Accepted v1 history is unchanged. After every v2 mutation the UI reloads server state and the domain schedule instead of predicting the outcome locally. Normal refresh keeps the previous valid Exchange state visible until the replacement arrives.

## Objects and consent

- An **intent** identifies one currently owned source membership. It may name up to ten explicit target assignments. Posting also allows other eligible members to offer a different assignment. There is no separate “open to offers” toggle. Duty Ops alone may allow a give-away.
- A **target** is an assignment, never a named recipient. Any eligible current member can accept it. The intent owner already consents to source → target.
- An **offer** binds the offerer's own source membership to an intent. Offering consents to offered source → requested source. If it was not an explicit target, the intent owner must confirm the exact result.
- A **candidate** is a concrete possible outcome. Its legs identify every user, assignment given, assignment received, captured assignment version and consent. Legs are not limited to two or three. A target acceptance, open offer, or matching suggestion can construct a candidate. A suggestion is never a commit.
- A give-away candidate has an owner leg with no received assignment and a claimant leg with no given assignment. Publishing `allowGiveAway` consents for the owner; claiming consents for the claimant.

Every affected member must consent to their **exact** give/receive result. A target choice, offer or give-away publication can supply that consent. Broad preferences are never consent. The first matching implementation searches direct edges and three-way cycles only; the schema can hold longer cycles, and a later preference scorer may rank suggestions without granting consent.

## Commit and reconciliation

Tentative objects never reserve an assignment. The commit uses a D1 batch with a guarded state revision, rechecking permissions, all current effective memberships, captured versions, exchangeability and time cutoff, exact consent, unique team composition, and the Duty Ops credit floor. The batch either writes every assignment effect, credit entry, event and terminal state, or writes nothing. On a successful commit, conflicting intents, offers, targets and candidates become `SUPERSEDED`; changed or no longer eligible sources become `INVALIDATED` or `EXPIRED`. Reasons are machine readable. A stale browser action is rejected at commit time even before background reconciliation runs.

Duty Ops and Flyvask commits append factual membership effects and durable slot transfers used by their effective assignment views. Raw FlightLogger assignment snapshots are untouched. [Assignment reconciliation](assignment-reconciliation.md) preserves one portal receiver per transferred slot and distinguishes a normal override from an upstream source conflict. A conflicted shift stays visible, but new exchanges pause and the final D1 guard rejects a stale commit with `EXCHANGE_ASSIGNMENT_SYNC_CONFLICT`. Brakkevakt commits change the published roster assignments and period revisions together. Duty Ops credit entries represent net workload: give and receive cancel to zero, while a give-away gives −1/+1. A three-person give-away chain can have deltas −1/0/+1; the first matcher does not yet discover chains automatically. A new result cannot take a member below −2; historical balances below the floor remain factual. Entries are immutable and unique per candidate/user. The existing Duty Ops credit balance and personal history include v2 credit entries without altering old entries.

Reconciliation evaluates open objects against current assignment state after synchronization, roster edits and commits, and also on API reads. A temporary Duty Ops/Flyvask integrity conflict pauses unsafe actions without cancelling accepted portal assignments or automatically invalidating still-open intent. The guarded final validation is authoritative and prevents partial effects or credits.

## Inbox and audit

`exchange_v2_events` is the immutable complete history. Event snapshots preserve assignment details and legs, with no credentials, token material or private email. The read-only `admin.exchange_audit` API and Administration page permit investigation by person, domain, outcome and recent date, with a chronological case timeline.

`user_inbox_items` is a relevance-filtered projection, not the audit. An actionable targeted request is for current target members. When another member accepts, unread items for uninvolved members disappear. A previously read item can remain as a concise unavailable notice. Participants whose own schedule changes asynchronously are informed; the actor who just received a success response does not get a redundant item. Source type `EXCHANGE` uses a stable source ID that the Inbox resolver maps to safe title, summary and target route. No Web Push, email or new Inbox UI is part of v2.

## Migration and release

`0012_exchange_v2.sql` introduced v2 tables and effects. `0016_assignment_reconciliation.sql` adds a shared durable transfer order, backfills accepted v1/v2 history, and replaces the Duty Ops/Flyvask effective views. Earlier migrations are untouched. Both commit paths use effective membership and integrity guards to prevent stale outcomes. Apply only through the repository's ordered preview/production release workflow; do not apply production D1 during development. The new migration is additive to stored data, though the effective views intentionally change how conflicting names are projected.

## API contract

All endpoints are same-origin JSON behind Cloudflare Access. Mutations require the domain's existing `*.swap` permission and same-origin protection. `GET /api/exchanges/v2/intents?domain=DUTY_OPS&assignmentIds=<comma-separated IDs>` returns visible intents, relevant candidates and canonical `assignmentStates` with `relationship`, `availableActions`, related IDs, valid request sources and offerable intent IDs. At most 100 requested assignment IDs are accepted per call; the frontend chunks larger schedules. Past/non-exchangeable assignments have no exchange action. A read also reconciles stale v2 objects.

| Operation | Route | JSON body |
| --- | --- | --- |
| Create intent | `POST /api/exchanges/v2/intents` | `{domain,sourceAssignmentId,targetAssignmentIds,allowGiveAway}` |
| Cancel intent | `POST /api/exchanges/v2/intents/:intentId/cancel` | `{}` |
| Claim give-away | `POST /api/exchanges/v2/intents/:intentId/claim` | `{}` |
| Generate direct/three-way matches | `POST /api/exchanges/v2/intents/:intentId/matches` | `{}` |
| Offer assignment | `POST /api/exchanges/v2/intents/:intentId/offers` | `{assignmentId}` |
| Accept targeted request | `POST /api/exchanges/v2/targets/:targetId/accept` | `{}` |
| Withdraw offer | `POST /api/exchanges/v2/offers/:offerId/withdraw` | `{}` |
| Confirm exact candidate outcome | `POST /api/exchanges/v2/candidates/:candidateId/confirm` | `{}` |
| Decline candidate | `POST /api/exchanges/v2/candidates/:candidateId/decline` | `{}` |

`GET /api/admin/exchanges` accepts optional `person`, `domain`, `status`, `from`, `to` filters. `GET /api/admin/exchanges/:intentId` returns a case timeline, legs and credit entries. Both require `admin.exchange_audit`, granted to ADMIN by migration 0012. The Administration UI is at `/admin/exchanges` and is read-only.

Posting an intent invokes matching for that intent and existing intents that can form a direct or three-way path to it. The initial matcher examines at most 200 open intents in a domain and creates at most ten candidate suggestions per root, trying direct matches before three-way cycles. The explicit match endpoint can be used to retry a particular open intent. It never treats implicit openness as consent. It verifies saved source versions and selected target snapshots before attributing consent. If all legs already have exact target consent, it attempts the guarded commit. A future matcher can score more candidates without changing the candidate/leg or final commit contract. A transient matcher failure does not roll back the newly posted intent; its response contains no candidates and matching can be retried.

Explicit candidate confirmation records that person's exact consent. If a concurrent change prevents final commit, the agreement remains tentative and a later read reconciles its state; no assignment or credit is partially applied.

For local development, run `npm run db:migrate:local` after updating the checkout, then use the existing Pages development command. Preview and production migrations must run through the ordered release workflow; no remote database change is needed to review this branch.
