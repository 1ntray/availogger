# Flyvask scheduling and direct swaps

Current UI: new Flyvask exchanges use [Exchange v2](exchange-v2.md), with implicit openness to offers, multiple selected targets and server-approved requests directly from the schedule. My upcoming, This week, Exchanges and the full Schedule are separate views of the same effective assignments. There is no give-away. The v1 request/proposal API below remains available for open v1 exchanges until they resolve.

## FlightLogger discovery

Flyvask is a `MeetingBooking` whose comment satisfies `comment.trim().toUpperCase() === 'FLYVASK'`. Classroom `602` / Hangar UTSA is metadata, never the inclusion rule. Flyvask in another room is included; another meeting in room 602 is excluded. Maintenance bookings are ignored.

The dedicated Flyvask query selects comment, UTC start/end, status, external reference, classroom metadata and participants. `FlightLoggerClient.flyvask(from, to, all)` shares only the small bounded meeting-pagination helper with Duty Ops: 50 nodes per page, a maximum of 1,500 records, cursor-progress/cycle checks, conflicting-record checks, overlap filtering, request budget and token-hashed 429 cooldown. A malformed or incomplete response never reaches the discovery save/delete operation.

Independent five-minute Flyvask freshness lives in `flyvask_sync_state`: global canonical discovery and `user:<portal-id>` with token hash. The default Oslo window covers 30 past and 60 future days; explicit ranges are bounded to 93 days. Duty Ops freshness and tables are unaffected.

- **all:true** discovers canonical shifts, stores participant count and classroom metadata, and discards all participant identities—even visible ones.
- **all:false** establishes only the authenticated user's association. The actor's self profile must match their stored FlightLogger ID. Only that actor's credential is decrypted; no cross-account requests are made.
- Trusted names come from the self-profile query. Masked participants remain counts such as “13 others”; null positions never establish identity.

Synchronization preserves local shift IDs, guards against older concurrent snapshots and account replacements, and removes absent records only inside the synchronized overlapping window. Own queries may insert a new canonical shift but cannot overwrite shared discovery metadata. Credential replacement invalidates own Flyvask freshness; changing the linked FlightLogger identity also clears that user's raw memberships. Migration 0007 installs a narrow trigger for these effects so existing credential code remains unchanged.

## Raw and effective assignments

`flyvask_assignments` contains only synchronized FlightLogger memberships. Swaps never insert or delete these rows or alter the source participant count.

Studentportal uses `flyvask_effective_assignments` as its operational authority. Each accepted direct swap produces four effects:

| Shift | Removal | Addition |
| --- | --- | --- |
| Requested | Requester | Accepted proposer |
| Offered | Accepted proposer | Requester |

The latest effect for each touched membership wins, ordered by acceptance timestamp then request ID. Acceptance allocates a strictly increasing timestamp within the D1 transaction. Untouched memberships follow the raw snapshot. Known aliases of the same FlightLogger identity are deduplicated, and former-holder aliases are suppressed.

This is the same idempotent reconciliation rule as Duty Ops v2. Original, intermediate and final FlightLogger catch-up snapshots yield the same effective state without double application or resurrecting earlier holders. Acquired assignments may immediately be requested or proposed in another swap, including swapping back to a previous holder. Every accepted agreement remains a separate history entry.

For touched memberships, the latest portal agreement remains authoritative until a future explicit audited reconciliation policy. Later unrelated administrative changes are not interpreted as revoking portal consent.

## Original v1 direct-swap flow

Flyvask has no give-away type, claim endpoint, “Take shift” button or one-way transfer. A request always seeks a reciprocal Flyvask assignment.

1. An eligible student selects **Look for swap** on their future, OPEN effective assignment. This publishes the request directly, without a type selector.
2. Other students may independently offer their own eligible Flyvask assignments. Multiple proposals can coexist.
3. The requester chooses a specific offer and confirms both shifts. The offer already represents the proposer's consent; there is no second confirmation.
4. Request and chosen proposal become ACCEPTED; other OPEN proposals become NOT_SELECTED and all request reservations are released atomically.

Only OPEN requests can be cancelled by their requester, and only OPEN proposals can be withdrawn by their proposer. Cancellation closes remaining proposals and releases locks. Normal student operations cannot undo accepted agreements.

Consent stores the displayed start/end times separately from source foreign keys. Already started, completed, cancelled, rescheduled or no-longer-held assignments are ineligible. Checks for both effective memberships, permissions, status, consent times and active reservations run inside the write transaction. The named CHECK guard aborts the entire [D1 transactional batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) on failed predicates; audit failure also rolls back state and locks. Exactly one concurrent proposal selection succeeds.

Reservations protect only OPEN intent. New assignments are never permanently locked after acceptance. Requests/proposals that become stale remain manageable by their owner; they cannot be accepted.

## Permissions and API

Migration 0007 grants `flyvask.view` and `flyvask.swap` to STUDENT and ADMIN. Existing explicit overrides still take precedence. Admin permission UI reads the typed catalogue automatically.

Reads require `flyvask.view`; every mutation requires `flyvask.swap`, with an additional transactional permission check. Duty Ops permissions do not authorize Flyvask. Mutations use strict, bounded JSON, validated IDs/timestamps, existing same-origin/CSRF rules and parameterized SQL. Responses use `Cache-Control: no-store`.

| Endpoint | Purpose/body |
| --- | --- |
| `GET /api/flyvask` | Synchronize/read schedule; optional `from` and `to` dates |
| `GET /api/flyvask/swaps` | Active OPEN workspace; optional keyset cursor |
| `POST /api/flyvask/swaps` | `{shiftId, startsAt, endsAt}`; no type field |
| `POST /api/flyvask/swaps/:requestId/cancel` | `{}` |
| `POST /api/flyvask/swaps/:requestId/proposals` | `{shiftId, startsAt, endsAt}` |
| `POST /api/flyvask/swaps/:requestId/proposals/:proposalId/accept` | `{}` |
| `POST /api/flyvask/swaps/:requestId/proposals/:proposalId/withdraw` | `{}` |
| `GET /api/flyvask/swaps/history` | Personal accepted history; optional keyset cursor |

Lists have 30-item pages and return `nextCursor`; proposals are bounded to 50 per request. Active lists use creation time/ID; history uses acceptance time/ID newest first. Invalid or losing mutations return safe conflicts. Audit records include REQUEST_CREATED, REQUEST_CANCELLED, PROPOSAL_CREATED, PROPOSAL_WITHDRAWN and PROPOSAL_ACCEPTED, with actor/time and optional proposal ID, never credentials.

## UI and history

`/flyvask` provides My upcoming, This week, a compact Exchange summary and the full date-grouped Schedule. Effective Studentportal participants are primary. Differing FlightLogger source assignments are available through an attention disclosure. Known participant names plus remaining source slots preserve the privacy-safe “others” presentation. New Exchange actions consume canonical v2 assignment state; active v1 exchanges retain their original controls. After acceptance, the schedule reloads and the received assignment can be exchanged again.

`/flyvask/swap-history` is a bookmarkable secondary tab. It shows only accepted agreements involving the authenticated requester or accepted proposer, from that viewer's perspective: counterparty, You gave, You received, and acceptance date/time. Unselected proposers cannot read the accepted agreement as their history. There is no user selector or email exposure. Stored consent times keep history displayable after source bookings are removed and foreign keys become NULL. View permission is sufficient even if swap permission was later revoked. Cancelled/withdrawn/not-selected activity stays in audit storage.

The module reuses the existing outline icons, compact meeting rows, dialogs and responsive CSS. Flyvask is in desktop navigation, mobile More and Home quick access; there is no new Home schedule dashboard. Times use Europe/Oslo and semantic time markup; history pairs stack on phones.

## Migration and release

`0007_flyvask.sql` adds source shifts/assignments/sync state, direct request/proposal/event/reservation/guard tables, indexes, effective-assignment views, permissions/grants and the credential-change trigger. Migrations 0001–0006 are unchanged. The additive schema is compatible with the old application during migration-before-deploy.

Normal releases use the existing ordered [release automation](database-updates.md): tests/build, target D1 migration, then deploy the exact commit. No preview/production migrations should be applied manually during implementation. No new binding, secret, API token or Cloudflare project is required.

From the repository root, local development uses:

```powershell
npm run db:migrate:local
npm run db:status:local
npm run check
npm test
npm --prefix frontend test
npm --prefix frontend run build
npm run functions:build
```

For an isolated local verification database, append `-- --persist-to .wrangler/flyvask-migration-verification` to both database commands. These commands remain local.

## Limits

FlightLogger remains read-only. Portal acceptance changes operational Studentportal assignments, not FlightLogger bookings. No booking/participant mutations, give-aways, task checklists, Web Push/email notifications, credits or transport integration are implemented. Exchange v2 can suggest direct and three-way matches; it does not optimize a preference schedule.

Membership discovery is gradual as students use the portal, not real-time cross-account verification. Failed refreshes return usable cached data with a compact stale indicator; new request/proposal/acceptance operations fail closed when required synchronization is stale. Cancellation, withdrawal and history do not require upstream connectivity or a credential. The bounded window/request budget may require a later deliberate pagination design for unusually large schedules.
