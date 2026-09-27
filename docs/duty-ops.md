# Read-only Duty Ops foundation

Branch: `feature/duty-ops-core`, based on `develop`. The PR targets **develop**, must be reviewed, and must not be merged automatically. Production `master` and its Pages Git deployment are unchanged.

## Data flow

Verified Cloudflare Access identity → existing D1 application user → decrypt that user's stored FlightLogger credential → bounded read-only FlightLogger queries → transactional D1 snapshots → `GET /api/duty-ops` → Duty Ops page.

The existing authentication, onboarding, `/api/me`, availability/calendar/KV cache, shell/navigation and static-only PWA worker remain in place. No new runtime secret or resource is required by Duty Ops.

### FlightLogger queries and privacy

`FlightLoggerClient.dutyOps(from, to, all)` uses `MeetingBooking`, `subtypes: [MEETING]`, `overlap: true`, `first: 50` and cursor pagination. It filters on classroom **ID `852`**; the display name is not the identifier. It accepts the documented booking lifecycle statuses and validates IDs, UTC dates, chronology, classroom, participant shape and page info. Unrelated meetings never reach D1/API. See the [official FlightLogger schema](https://api.flightlogger.net/).

- **`all:true`** discovers the canonical shared Duty Ops shifts visible to the requesting student's credential. Only participant array **length** is retained. Every participant ID/name, including self, is discarded from booking parsing.
- **`all:false`** establishes membership for the **server-resolved requesting user**, for each Duty Ops booking returned. It does not require a visible self participant: an associated booking can have all participants masked. No other user's assignment is created from these results.
- **`query CurrentUserProfile { user { id firstName lastName } }`** obtains the authenticated student's own trusted name. Its ID must equal the ID validated during onboarding/replacement. Only that user's D1 name is updated. Frontend-supplied IDs/names are never accepted.

Students' names appear gradually as they visit Duty Ops and synchronize themselves. If three slots exist and one identity is known, the UI shows `Simon Student · 2 others`. No null-slot/index matching, identity inference or privacy bypass occurs. Unknown names use `Student`; email is not used to invent a name. Multiple Access subjects connected to the same FlightLogger identity count once in the displayed participants.

### Migration `0002_duty_ops.sql`

| Table/change | Purpose |
| --- | --- |
| Nullable first/last-name columns on `users` | Safe upgrade of existing users; hydrated on Duty Ops sync |
| `duty_ops_shifts` | Stable internal UUID, unique FlightLogger booking ID, UTC start/end, status, observed slot count, optional external reference, last sync timestamp |
| `duty_ops_assignments` | Many-to-many `(shift_id, user_id)` primary key, foreign keys/cascades, last-seen timestamp |
| `duty_ops_sync_state` | Separate `global` and `user:<UUID>` windows/timestamps; own state includes a credential hash |

Internal shift UUIDs survive external booking upserts. Future portal swaps/tasks can reference a stable local key while FlightLogger remains the source of booking times. External references stay server-side. No operational write API is implemented.

### Freshness and reconciliation

`DUTY_OPS_TTL_MS` is **five minutes** for both discovery and own assignments, checked independently. D1 serves fresh reads without calling FlightLogger. A new student can synchronize their assignments without repeating fresh shared discovery. Missing/stale stages refresh on page entry/reload; no Cron or background polling is added. The open page updates age/date labels each minute and reloads at an Oslo date change. Reload uses the same TTL rather than forcing upstream refresh.

Default window: Oslo today **−30 through +60 days**, inclusive. Optional paired `from`/`to` dates use `YYYY-MM-DD`, at most **93 days**; invalid/duplicate/extra parameters are rejected. UTC query bounds are half-open Oslo midnights, including 23/25-hour DST days. Stored booking instants remain canonical UTC; the UI uses actual times in Europe/Oslo. There are no fixed morning/evening slots.

Each stage fetches **all pages before writing**. Discovery atomically upserts metadata, deletes absent shared shifts that overlap its successfully fetched window, and records freshness. Own sync atomically inserts missing shifts, reconciles **only that user** within the overlapping window, upserts assignments/name and records own freshness. An own sync never replaces existing shared metadata or removes another user's assignments. Shared discovery may remove an absent canonical shift and cascade its obsolete assignments. Records outside the completed window are untouched. Repeated synchronization is idempotent.

Parameterized JSON bulk SQL avoids one statement/parameter group per booking. D1 supports SQLite's [JSON extension](https://developers.cloudflare.com/d1/sql-api/sql-statements/); the migration and bulk statements are exercised against local D1. The client permits at most **30 FlightLogger calls total** per Duty Ops request and **1,500 raw meetings per query**, with 50 per page, leaving headroom for Access/D1 on Free. Cyclic/stuck cursors, excessive pages, malformed/conflicting records and partial responses fail the stage rather than writing a truncated snapshot. See [D1 invocation limits](https://developers.cloudflare.com/d1/platform/limits/).

Older refresh timestamps cannot replace/remove newer rows. An in-flight sync with a replaced credential cannot restore old personal assignments. Replacement invalidates own freshness; changing FlightLogger identity also clears that user's old assignments/names, while retaining the shared schedule. In-flight identical requests coalesce within an isolate; D1 remains the freshness authority. Separate isolates may duplicate refresh work, without a distributed lock.

If refresh fails, overlapping prior discovery **and matching-credential own** snapshots are returned with `sync.stale`, a safe warning and the actual coverage/timestamps. Empty successful snapshots are valid. Coverage gaps after window changes must not be interpreted as confirmed empty dates. Without usable snapshots the API returns a safe 503, or 429 with Retry-After; no upstream bodies, credentials, ciphertext or GraphQL responses are exposed/logged.

## API and UI

`GET /api/duty-ops` uses the existing `/api/*` Access middleware and application-user wrapper. It returns:

```json
{
  "from": "2026-08-28",
  "to": "2026-11-26",
  "timeZone": "Europe/Oslo",
  "shifts": [
    {
      "id": "internal-shift-uuid",
      "startsAt": "2026-09-28T05:00:00.000Z",
      "endsAt": "2026-09-28T12:00:00.000Z",
      "status": "OPEN",
      "participantCount": 3,
      "participants": [{ "userId": "portal-user-uuid", "firstName": "Simon", "lastName": null, "isCurrentUser": true }]
    }
  ],
  "sync": {
    "stale": false,
    "warning": null,
    "discovery": { "lastSyncedAt": "2026-09-27T12:00:00.000Z", "stale": false, "from": "2026-08-27T22:00:00.000Z", "to": "2026-11-26T23:00:00.000Z" },
    "assignments": { "lastSyncedAt": "2026-09-27T12:00:00.000Z", "stale": false, "from": "2026-08-27T22:00:00.000Z", "to": "2026-11-26T23:00:00.000Z" }
  }
}
```

Responses are `no-store`, authenticated and same-origin. Unsupported methods return 405; missing personal credentials return `409 ONBOARDING_REQUIRED`. The browser fetches relative `/api/duty-ops`; there is no new Vite API variable or localhost production fallback. The existing PWA does not cache this endpoint.

`DutyOpsPage` and isolated `features/duty-ops/` API/types/presentation/styles replace the placeholder. Desktop shows Today and My shifts alongside each other, then the date-grouped Schedule. Phones stack Today → My shifts → Schedule, without horizontal page scrolling. Own rows have a restrained green highlight; cancelled shifts are labelled and excluded from My shifts. Today includes shifts overlapping the local date; upcoming lists include ongoing shifts and exclude finished ones. Cross-midnight times include the end date.

## Local setup and checks

From repository root, using existing ignored `.dev.vars` with `LOCAL_ACCESS_DEV=true` and a **local** encryption key:

```bash
npm ci
npm --prefix frontend ci
npm run db:migrate:local
npm run db:status:local
npm run build
npm run dev
```

Open `http://localhost:8788/duty-ops`. Existing users remain connected; new users onboard normally. Optional Vite hot reload remains `npm --prefix frontend run dev` with local Pages running. Never bind local development to production storage.

```bash
npm run check
npm test
npm --prefix frontend test
npm run build
npm run functions:build
```

Tests use synthetic users/keys, real disposable Miniflare D1 and mocked FlightLogger/JWKS. They cover >50 pagination in both modes, privacy, filtering, dates/DST/boundaries, idempotency, bulk inserts, atomic rollback, separate TTLs, reconciliation/other-user preservation, replaced connections, stale fallback/429, safe Access/API behavior, page rendering and same-origin calls. No CI request goes to live FlightLogger or Pages.

## Manual Cloudflare steps

**No remote migration or production deployment is performed by this feature branch.** No Access changes, additional KV namespace, encryption-key rotation or new secret is needed.

1. Review the PR targeting **develop**. Production still deploys only from **master**.
2. For live preview/staging tests, provision a **separate D1 database** and retain the configured isolation: `env.preview.d1_databases`/`kv_namespaces` are currently empty and preview API deliberately fails closed. Add the real staging DB binding (`DB`, its actual name/UUID, `migrations_dir: "./migrations"`) under `env.preview`, and a separate preview KV binding `AVAILABILITY_CACHE`. Do not copy production credentials into preview.
3. Configure preview's existing encryption-key format using a **separate key**, plus verified `CF_ACCESS_TEAM_DOMAIN` / preview application's `CF_ACCESS_AUD`. Protect the preview hostname with Cloudflare Access; do not enable `LOCAL_ACCESS_DEV` publicly. Onboard a test student's personal key into preview.
4. After preview bindings are configured, the administrator applies its migrations:

   ```bash
   npx wrangler d1 migrations apply DB --remote --env preview --config wrangler.jsonc
   npx wrangler d1 migrations list DB --remote --env preview --config wrangler.jsonc
   ```

   Confirm `0002_duty_ops.sql` is applied before activating the new Functions.
5. Verify `/api/me`, `/api/duty-ops`, Today/My shifts/Schedule, reload within/after five minutes, and uncached Instructor Availability. Use two authorized student accounts to verify names appear after each self-sync and own reconciliation preserves the other student's assignment. Do not publish keys/headers in diagnostics.
6. If a later reviewed release promotes this code to master, **before that deployment** apply the additive migration to the existing production DB:

   ```bash
   npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
   npx wrangler d1 migrations list DB --remote --config wrangler.jsonc
   ```

   Confirm the target is `studentportal-db` before accepting Wrangler's prompt. The new credential replacement code also requires migration 0002. Retain existing production Access, encryption secret, DB/KV bindings, DNS and Pages build settings. No direct deploy or master merge is part of this task.

## Limitations and next phase

- Shared discovery assumes the authorized program students have the tested visibility of classroom 852. It reflects the requesting credential's permitted schedule, not administrative access; no cross-program/tenant or role model is added. A masked/unreadable meeting classroom fails synchronization conservatively because it cannot prove whether the record is Duty Ops; prior snapshots are preserved.
- Participant identities are incomplete until students use Duty Ops. Other students' assignments can remain stale until they revisit; known names may briefly exceed a newly reduced slot count. Unknown counts clamp at zero instead of inventing negative slots.
- Refresh happens on visits/reload, not Cron/polling. No historical UI or date-range controls are added; recent history is available through the bounded API.
- Requests exceeding pagination budgets fail safely. Large schedules and actual Workers Free CPU behavior still need staging verification with real permitted data.
- Local/browser/CI checks validate behavior using synthetic data; they do not establish a successful live rollout or device installation.
- No swaps, FlightLogger mutations, scheduling/admin, fuel, tasks, handover, transport or notifications. Next: validate the read-only module in staging with several students, then design the swap workflow against stable shift/assignment IDs.
