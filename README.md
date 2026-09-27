# Luftfartsfag Studentportal

An operational portal for pilot students. Instructor Availability and read-only Duty Ops are implemented; Home shows today's Duty Ops or the current user's next shift, with quick navigation; Transport remains planned. The repository and Cloudflare Pages project retain the name `availogger`.

## Deployment status

Production `master` auto-deploys Pages. The `develop` branch includes read-only Duty Ops and D1 authorization; UI pull requests target **develop**, not master. CI checks pushes to both `master` and `develop`, plus pull requests. Required migrations (`0002_duty_ops.sql` and `0003_authorization.sql`) must be applied to the target database before code that depends on them is activated. UI work does not perform migrations or production deployment. See the setup guides for separate production/preview resources and live verification.

See [Duty Ops setup, implementation and limitations](docs/duty-ops.md) for this phase and [the per-user setup guide](docs/per-user-flightlogger.md) for the existing foundation. The old shared `FLIGHTLOGGER_API_TOKEN` was removed after production verification; there is no shared-token fallback. The user's actual `.dev.vars` is not modified.

## Architecture

The portal also has [D1 authorization and user administration](docs/authorization.md): ADMIN/STUDENT roles, application-defined permissions and per-user ALLOW/DENY overrides. Availability requires `availability.view`; Duty Ops requires `duty_ops.view`. STUDENT defaults to Duty Ops and Transport view. Review the authorization migration and bootstrap-secret setup before activating this branch.

```text
Wix main website: luftfartsfag.no (unchanged)
Wix DNS: student.luftfartsfag.no CNAME -> availogger.pages.dev

student.luftfartsfag.no
  -> Cloudflare Access (authentication and allow policy)
  -> Cloudflare Pages project: availogger
       React portal -> same-origin /api/* Pages Functions
                        -> verified Access subject/email
                        -> D1 application user
                        -> encrypted personal FlightLogger credential
                        -> server-side decrypt -> FlightLoggerClient(userToken)
                        -> existing KV availability cache / FlightLogger API

GitHub 1ntray/availogger -> CI + Pages Git integration (master)
```

**Access identity** identifies the portal user. **The FlightLogger API key** is that user's external service credential; it does not sign them into the portal. Access remains the sole authentication system. There are no custom passwords, application sessions or browser bearer tokens.

Application users are keyed by the verified Access JWT subject, with an internal UUID. Verified email metadata updates when Access reports a change. Two subjects with the same email remain separate users. Requests cannot supply a user ID/email to select someone else's credential.

### First login and replacement

Access sign-in -> `/api/me` finds/creates the D1 user -> missing credential redirects to `/onboarding` -> personal key submitted -> backend validation/encryption/atomic save -> input cleared -> current-user refresh -> Home. Normal portal pages remain blocked until onboarding is complete.

Settings adds **FlightLogger — Connected — Replace API key**. Replacement validates first, then commits the new encrypted credential and FlightLogger user ID together. Invalid replacements leave the existing connection intact. The existing key is never displayed or returned to the browser. `Connected` means a validated credential is stored; revocation may require replacement later.

## Routes and retained UI

| Route | Current module |
| --- | --- |
| `/onboarding` | Mandatory personal FlightLogger connection |
| `/` | Today's Duty Ops, next personal shift when today is empty, and quick navigation |
| `/availability` | Working Instructor Availability |
| `/duty-ops` | Today, My shifts and date-grouped Duty Ops schedule |
| `/transport` | Planned car bookings and shared rides |
| `/settings` | Account, connection replacement, installation/updates |
| `/admin/users` | Permission-protected portal user access editor |

The existing top bar/sidebar, Home page, mobile Home/Duty Ops/Transport/More navigation and visual identity are preserved. Settings is in the desktop sidebar. Mobile More opens Availability, Settings and permitted Admin navigation; iPhone safe areas remain. Onboarding is a restrained standalone screen.

React Router handles navigation. Pages' default SPA fallback supports direct links/refreshes; no root `404.html` or catch-all redirect is added. `frontend/public/_routes.json` invokes Functions for `/api` and `/api/*`, including JSON 404. The current-user provider holds safe account state in React memory and adds `refresh()`.

## API

All routes run behind the existing Access middleware and return `Cache-Control: no-store`.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/me` | Verified `email`, `subject`, `onboardingComplete`, `hasFlightLoggerCredential`, nullable `flightLoggerUserId`, effective `permissions`, role keys |
| `POST /api/onboarding/flightlogger` | JSON `{ "apiKey": "..." }`; validate, encrypt and connect/replace the current user's credential |
| `GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD` | Requires `availability.view`; current user's calendar, validated inclusive range of 1–62 days |
| `GET /api/duty-ops` | Requires `duty_ops.view`; D1-backed shared shifts, current-user assignments, known participants and separate freshness metadata; optional paired dates, maximum 93 days |

Onboarding success returns only `{ "connected": true, "flightLoggerUserId": "..." }`. Missing credentials return 409 with `ONBOARDING_REQUIRED`. Invalid keys return a safe 422, rate limits 429 with Retry-After, and configuration/service failures fail closed. No token/ciphertext/IV/key/JWT is returned. Wrong methods return 405; there is no generic GraphQL proxy, CORS layer or `ALLOWED_ORIGINS`.

The connect endpoint accepts only one API-key field, bounds body/token lengths, rejects identity fields/query parameters and cross-site writes, and trims surrounding copy/paste whitespace. The key is sent once in a same-origin HTTPS POST body, never a URL; request bodies and upstream exceptions are not logged.

Validation uses `query CurrentUser { user { id } }` with `Authorization: Bearer <submitted token>`. The documented `user` query without an ID returns the API-key user, a small read-only request: [FlightLogger reference](https://api.flightlogger.net/). For obtaining API access, consult the API section of FlightLogger's Help Center from your account; the portal does not invent generation instructions.

## D1 and encryption

`migrations/0001_application_users.sql` creates:

- `users`: UUID, unique Access subject, verified email, nullable FlightLogger user ID and ISO timestamps.
- `flightlogger_credentials`: one row per user, foreign key with cascade deletion, Base64 ciphertext/IV, encryption version and timestamps.

`migrations/0002_duty_ops.sql` adds nullable trusted self-name fields, shared Duty Ops shifts, many-to-many assignments and separate global/own sync state. Internal shift UUIDs stay stable across FlightLogger upserts. Queries are parameterized. Credential replacement and FlightLogger user ID updates use a transactional D1 `batch`; a failed write rolls both back. Replacement invalidates own Duty Ops freshness and clears old assignments/names if the external identity changes. Authorization roles/permissions/audit tables are added separately by `0003_authorization.sql`. Duty Ops remains read-only.

Web Crypto **AES-256-GCM** uses a fresh random **12-byte IV** per save, a 128-bit authentication tag and AAD `studentportal:flightlogger:v1:<internal-user-id>`. Version 1 is explicit in schema/service. Copying ciphertext to another user or tampering fails authentication. Plaintext is never stored in D1.

`FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY` is canonical standard Base64 encoding of **exactly 32 random bytes** (44 characters with padding, no whitespace). It is the portal's master encryption key, **not a FlightLogger token**. Missing/malformed values fail closed. Store it as an encrypted Pages runtime secret, never in Git or a `VITE_*` variable.

**Keep a secure backup.** Losing/changing the key without migrating records makes existing credentials unreadable. Restore the original to recover; if lost, users must replace their personal keys after a valid key is configured. With a syntactically valid wrong key, Settings remains available while availability decryption fails. No automatic rotation is implemented; future rotation requires a deliberate version/schema migration and re-encryption.

## Availability and cache

The calendar still starts today in Europe/Oslo, with future months, search, sticky instructor names, horizontal scrolling, cache age/reload and available/unavailable/no-information cells. Unavailability wins over available overlap; no record means no information, not booking-free time. Oslo DST days may be 23/25 hours.

Cache format remains `availability:v1:<SHA-256(token)>:<from>:<to>`. Raw tokens, emails and Access subjects never appear in KV keys. Different tokens isolate cached permissions/data; identical tokens intentionally share the same account-scoped cache. The current user's credential is resolved/decrypted before any cache lookup. Replacement selects the new token's cache; old entries expire naturally.

Successful results retain `cachedAt` for **24 hours** in KV, with a **60-second** hot cache and same-token/range in-flight deduplication. Reload does not bypass the cache. Upstream cooldowns now use token hashes so one token's 429 cannot block another token in the same isolate. Pagination limits/cursor checks remain. KV is eventually consistent; separate locations may duplicate a miss.

FlightLogger's availability filters use start/end containment, not overlap. Existing 90-day padding remains; a period extending beyond the padded boundaries may be missed. Fixed read-only queries and calendar semantics are unchanged.

## Duty Ops

Duty Ops is now a read-only operational module: **Today**, **My shifts**, and the upcoming date-grouped **Schedule**. Desktop shows Today/My shifts side by side; mobile stacks them before Schedule. Dedicated feature styles leave the shared portal UI unchanged. UTC instants display in Europe/Oslo, including overnight and DST shifts. Home reuses the same read API and shift presentation: today's shifts take priority, otherwise the first upcoming personal shift is shown when present. Users without `duty_ops.view` see no Duty Ops Home section or link and make no Duty Ops request. Loading and errors stay within the summary; quick navigation remains usable. Stale returned schedules are identified. Transport retains its Coming soon label.

FlightLogger `MeetingBooking` records in classroom ID **852** supply the data. Paginated `all:true` discovers shared shifts and slot counts; `all:false` associates only the requesting portal user. An authenticated self query supplies that student's trusted name. Other participant identities are discarded, including unmasked entries. Known names accumulate as students synchronize; three slots with one known student display `Simon · 2 others`.

D1 is the normal read source, with separate **five-minute** discovery/own freshness and a default **30 past / 60 future days**. Only completed queries reconcile data; own reconciliation preserves other users' assignments. On refresh failure, usable earlier data returns with explicit stale metadata. No usable snapshot means a safe service error. Reload honors the TTL, and no Cron/polling or API service-worker cache is added.

Read [the full Duty Ops guide](docs/duty-ops.md) for schema/query decisions, API shape, pagination bounds, migration/preview setup, verification and limitations.

## Local development

Use Node 22+, from the repository root:

```bash
npm ci
npm --prefix frontend ci
npm run db:migrate:local
npm run db:status:local
npm run build
npm run dev
```

Before starting dev, create/update the **ignored root** `.dev.vars` yourself:

```dotenv
LOCAL_ACCESS_DEV=true
FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY="your-locally-generated-32-byte-base64-key"
```

Generate a local key (output is sensitive; save securely, never post it in diagnostics):

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
```

Use a **different key from production**. Keep it stable while retaining local credentials. `.dev.vars.example` documents the format without containing a key. The local path no longer requires `FLIGHTLOGGER_API_TOKEN`; remove its obsolete entry yourself after onboarding works.

`npm run dev` uses **`wrangler.local.jsonc`** with local D1 (`DB`) and KV (`remote: false`), no production D1 ID and ignored disk state under `.wrangler/state`. Migration/status commands use the same config. No Cloudflare login or production resources are required. Open `http://localhost:8788`; the fixed local Access user goes through the same D1/onboarding/encryption flow. Real local key validation/schedules require FlightLogger connectivity; tests mock it.

`LOCAL_ACCESS_DEV=true` works only on loopback (`localhost`, `127.0.0.1`, `[::1]`). Public/custom/preview hosts cannot bypass Access. Never set it on Pages. Old ignored `worker/` files are not read. Never bind local DB to production.

Optional hot reload: leave Pages dev running, then run `npm --prefix frontend run dev`. Vite proxies `/api` to local Pages on port 8788. Production fetches remain relative; no `VITE_API_BASE_URL` dependency or localhost fallback. Rebuild to update assets served directly by Pages.

### Checks

```bash
npm run check
npm test
npm --prefix frontend test
npm run build
npm run functions:build
```

Tests use synthetic keys/generated JWTs, mocked JWKS/FlightLogger and disposable local Miniflare D1 applying the real schema. They do not read real secrets or call production services. Coverage includes identity isolation, encryption/tampering, safe API shapes, atomic replacement/rollback, token-hashed cache isolation, onboarding gates/state/input/storage and PWA exclusions. Functions output stays ignored under `.wrangler/pages-build`.

## Cloudflare Pages and production setup

| Setting | Keep |
| --- | --- |
| Project / production branch | `availogger` / `master` |
| Repository / root | `1ntray/availogger` / repository root (blank or `/`) |
| Build command | `npm ci && cd frontend && npm ci && npm run build` |
| Output / Node | `frontend/dist` / `22` or newer |
| Custom domain | `student.luftfartsfag.no` |
| KV binding | `AVAILABILITY_CACHE`, existing ID `ccce02514a2b44d2a7698529136751fd` |
| D1 binding | `DB`, existing `studentportal-db`, ID `a6a29063-bacf-454f-8423-5e956e769e5f` |
| Access bindings | `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, unchanged |
| Runtime secret | Existing `FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY`, retained |

Root `wrangler.jsonc` is the Pages configuration source of truth, with the existing real production DB/KV IDs. Keep these bindings and the encryption key. Apply new migrations before activating code that requires them; see the Duty Ops guide. Local config is separate.

Access still verifies RS256 signature, exact issuer/audience, expiry/not-before, email and subject using team JWKS. Arbitrary email headers never establish identity. Keep Access covering the **entire hostname**, including onboarding/API, and protect aliases/previews too. Existing encrypted `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` dashboard bindings remain valid configuration. No policy redesign is required. See [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

Follow [the existing foundation setup guide](docs/per-user-flightlogger.md) and [Duty Ops migration/verification steps](docs/duty-ops.md). Production/preview resources are separate: do not expose production DB/key in an untrusted preview. Previews without required resources intentionally return 503. CI and Pages Git integration are preserved; no redundant deployment workflow.

If `/api/me` serves HTML, check repo root/output settings, deployed commit and Functions compilation. SPA fallback on an API URL means the route is missing, not an Access-policy problem. Keep `functions/` tracked. Root-only ignore `/API/` prevents the Streamlit reference folder from hiding `functions/api/` on Windows.

## PWA installation and sensitive data

The existing manifest/icons/service worker/install UI remain: **Luftfartsfag Studentportal**, short name **Studentportal**, start URL/scope `/`, standalone, existing LF colors.

- **Android / desktop:** browser Install app option or Settings button when offered.
- **iPhone / iPad:** Safari -> Share -> Add to Home Screen; Open as Web App if offered.
- A network connection is needed for Access, onboarding and schedules. No notification permission is requested.

Workbox precaches only versioned JS/CSS, icons and public manifest. It does **not** cache HTML navigation, `/api/me`, `/api/availability`, `/api/duty-ops`, onboarding POST bodies/responses, credentials, identity or Access pages. No API runtime cache/offline fallback is added. Keys remain in transient form state, cleared on success/discarded on unmount, never localStorage/sessionStorage/IndexedDB/analytics/URL/history.

Registration is production-build only; updates wait for tabs to close or Settings **Update and reload**. Inspect Cache Storage after onboarding: only static assets should appear. Real Android/iOS installation and Access expiry still need device verification. Icons remain replaceable (`cd frontend && node scripts/generate-icons.cjs`).

## Source layout and retained infrastructure

- `frontend/src/app/`: retained shell/navigation/provider plus onboarding gates.
- `frontend/src/pages/OnboardingPage.tsx`, `frontend/src/features/flightlogger/`: connect/replacement UI and relative API.
- `functions/api/`: Access middleware, extended me, per-user availability, onboarding POST and JSON fallback.
- `backend/users.ts`, `credential-encryption.ts`, `flightlogger-credentials.ts`, `credential-request.ts`, `application-api.ts`: reusable security/application services.
- `backend/flightlogger/`: client/fixed queries and retained calendar/pagination.
- `backend/duty-ops/`, `functions/api/duty-ops.ts`, `frontend/src/features/duty-ops/`: bounded synchronization, normalized read API and isolated Duty Ops presentation.
- `migrations/`, `wrangler.jsonc`, `wrangler.local.jsonc`: schema and production/local config.
- `frontend/src/pwa/`: unchanged static foundation; `test/`, `frontend/test/`: checks.

The old standalone Worker was deleted after the user verified production cached/uncached schedules. Keep its historically named KV `availogger-api-availability-cache`; Pages uses it. The old GitHub Pages workflow is removed. If its old site remains published, unpublish under GitHub Settings -> Pages. Cloudflare Pages + CI remain the deployment path.

## Next phase and limitations

Validate read-only Duty Ops in staging with multiple students, then design swaps using the stable local shift/assignment IDs and existing authorization foundation. Schedule editing, swaps, fuel, transport, cohorts, personal flight schedules, AI and notifications remain unimplemented. Future push: `Access identity -> D1 user -> device subscriptions -> Pages Functions -> Web Push`; no subscription tables/VAPID keys/handlers yet.

No disconnect/delete-account UI, automatic key rotation or continuous upstream health check. Revoked tokens may retain 24-hour cached availability. Duty Ops identities can remain partial/stale until students synchronize, and shared discovery assumes the verified program-student visibility. The portal can only show data the personal FlightLogger key permits. Before deploying Duty Ops to another environment, verify its required migrations and read-only behavior with multiple students in staging.
