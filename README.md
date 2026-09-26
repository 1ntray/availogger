# Luftfartsfag Studentportal

An operational portal for pilot students at Luftfartsfag. Instructor Availability is the first implemented operational module; Home provides an honest starting overview, while Duty Ops and Transport are clearly marked as planned. The repository and Cloudflare Pages project retain the name `availogger`.

Instructor Availability starts today in Europe/Oslo, with future month navigation, search, sticky instructor names, horizontal calendar scrolling, cache age, reload, and available/unavailable/no-information day cells. The application remains read-only.

## Portal routes and navigation

| Route | Current module |
| --- | --- |
| `/` | Home / Today, empty overview and quick navigation |
| `/availability` | Working Instructor Availability calendar |
| `/duty-ops` | Planned schedule, swaps and operational tools |
| `/transport` | Planned car bookings and shared rides |
| `/settings` | Access account email, app installation and update controls |

Desktop uses a persistent top bar and left navigation. Tablet and phone layouts use Home, Duty Ops, Availability and More in a bottom bar; More opens Transport and Settings. The layout reserves iPhone safe areas. The calendar scrolls within its own container, without widening the portal.

React Router handles client navigation. Cloudflare Pages' default SPA fallback handles direct links and refreshes (there is no root `404.html` or catch-all redirect). The existing `_routes.json` continues to send `/api/*` to Pages Functions, including their JSON 404 handler. The current-user provider reads `/api/me` once per app mount and holds only email/subject in memory; it creates no application session or browser identity storage.

## Install as an app

Use the production HTTPS site, `https://student.luftfartsfag.no`, and sign in through Cloudflare Access.

- **Android (supporting browsers):** choose Install app from the browser menu, or use the subtle Install app button under Settings when the browser offers installation.
- **Desktop (supporting browsers):** use the browser's install icon/menu or Settings.
- **iPhone / iPad:** open in Safari, tap Share, then Add to Home Screen. Choose Open as Web App if offered. There is no simulated native prompt.
- Installation availability depends on the browser. Standalone mode is detected in Settings. No notification permission is requested.

The manifest names the app **Luftfartsfag Studentportal**, short name **Studentportal**, with `/` as start URL/scope, standalone display, and existing blue/green colors. Simple LF lettermark icons (192/512px, maskable 512px, Apple 180px and SVG) are local assets, easy to replace. Regenerate PNGs with `cd frontend && node scripts/generate-icons.cjs`.

### Service worker and Access

Vite PWA's Workbox `injectManifest` build precaches versioned JS/CSS, icons and the public app manifest only. It does **not** cache navigation HTML, `/api/*`, identity, Access login pages, or availability responses; fresh launches and reloads still go through Cloudflare Access. The server's 24-hour KV cache remains authoritative. API data and email are held only in the running React app, never in Cache Storage/localStorage/sessionStorage. A network connection is required for sign-in and schedules; this is not an offline schedule viewer.

Service worker registration runs only in production builds (including local production preview / Pages dev after building). Development via Vite has no service worker. Updated versions wait for existing tabs to close or an explicit **Update and reload** under Settings, avoiding an unexpected calendar reload. Old static precache entries are cleaned on activation. `frontend/src/pwa/sw.js` is the small future extension point for Web Push; no subscriptions or push handlers exist yet. Manifest requests use same-origin credentials so installation works behind Access. See [Vite PWA React integration](https://vite-pwa-org.netlify.app/frameworks/react) and [Workbox integration](https://vite-pwa-org.netlify.app/guide/inject-manifest).

### Deployment checks for this phase

No new Cloudflare bindings, secrets, DNS changes or deployment workflow are required. Keep the existing Access policy covering the entire hostname, including all portal routes and `/api/*`. The current Pages build command/output and Git deployment from `master` stay the same.

After deployment, sign in and refresh `/availability`, `/duty-ops`, `/transport` and `/settings` directly. Confirm `/api/me` returns JSON and the calendar still loads future uncached ranges. Check that `/manifest.webmanifest` and `/sw.js` return their assets after sign-in, and try installation on a supporting browser. In browser developer tools, confirm service worker caches contain only static assets/icons/manifest and never `/api/me`, `/api/availability`, HTML or Access URLs. Test expiry by signing out and reopening the app: API access must still require Access. Real Android/iOS installation and account-specific Access expiry need device verification.

## Planned modules and notifications

Future modules include Duty Ops schedules, swaps and scheduling/admin, fuel requests, task checklists/handover, aircraft fuel status, university transport/private rides, preferences and notifications. None of their business logic or records are implemented here.

The intended notification architecture is:

```text
Verified Cloudflare Access identity
  -> D1 application user
  -> push subscription(s) per device
  -> Pages Functions
  -> Web Push
```

Possible events include upcoming duties, swap requests, fuel requests/completion, handovers and transport rides. D1, roles, subscription tables, VAPID keys, notification permissions, push delivery and per-user FlightLogger tokens are all deferred. The next phase should define the application user foundation keyed by verified Access subject, then choose one operational module.

## Architecture and migration status

```text
Wix main website: luftfartsfag.no
Wix DNS: student.luftfartsfag.no CNAME -> availogger.pages.dev

student.luftfartsfag.no
  -> Cloudflare Access (sign-in and access policy)
  -> Cloudflare Pages project: availogger
       React frontend -> same-origin /api/* Pages Functions
                           -> existing KV availability cache
                           -> FlightLogger GraphQL (shared server-side token)

GitHub 1ntray/availogger -> CI + Pages Git integration (master)
```

Wix hosting and the existing CNAME remain unchanged. Production now uses Pages Functions behind Cloudflare Access. The user verified sign-in and availability, including previously uncached future months, after deleting the old standalone `availogger-api` Worker. The existing KV namespace remains in use. The standalone Worker deployment files and CORS routing layer have been removed from the repository.

### Source layout

- `frontend/src/app/`: React Router routes, shared shell/navigation and current Access user provider.
- `frontend/src/pages/`: Home, extracted Availability, Duty Ops/Transport placeholders and Settings.
- `frontend/src/pwa/`, `frontend/pwa.config.ts`, `frontend/public/icons/`: installation, static service worker and replaceable app assets.
- `frontend/src/`: existing availability API, calendar/date/cache helpers. `frontend/test/` retains their tests and adds route, identity and PWA checks.
- `functions/api/`: Pages routes, Access middleware, availability, `/api/me`, and JSON 404 for unknown API routes.
- `backend/availability.ts`: shared date validation, cache, response mapping and safe errors.
- `backend/access.ts`: verified Access identity, reusable for future D1 user mapping.
- `backend/flightlogger/`: existing client, fixed queries, pagination protection and Oslo calendar calculations, moved without duplication from the retired Worker.
- `test/`: Pages routes, Access verification, availability caching, FlightLogger client/calendar and frontend API error tests.
- `wrangler.jsonc`: Pages configuration, existing KV ID, compatibility date and `frontend/dist` output.
- `.github/workflows/ci.yml`: frontend and backend checks. Cloudflare's existing Git integration deploys Pages; there is no duplicate GitHub deployment workflow.

Inspection found no remaining custom password-auth modules, D1 migrations, user-management scripts or session code in this repository. None are introduced here. `API/` remains the separate ignored Streamlit reference repository.

## API and Access identity

- `GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD`: validated inclusive range, at most 62 days.
- `GET /api/me`: `{ "email": "...", "subject": "..." }` from verified Access identity. Useful for checking the integration; not an application user database.
- All `/api/*` routes pass through Access verification before touching KV or FlightLogger. Other API routes return JSON 404; there is no instructors endpoint or generic GraphQL proxy.
- Wrong methods return 405. There is no application CORS/preflight layer and no `ALLOWED_ORIGINS` binding in Pages.

The browser calls a relative `/api/availability?...` URL with same-origin credentials. Cloudflare Access manages its own cookie and injects `Cf-Access-Jwt-Assertion` at the edge. The application does not manage passwords, sessions, bearer tokens or browser auth storage. Expired Access sessions prompt the user to reload and sign in again.

The backend uses `jose` and the Access team's `/cdn-cgi/access/certs` JWKS to verify the RS256 signature, exact issuer, application audience, expiry and not-before time. It requires an application token with email and subject. Signing keys are cached and refreshed by the JWKS verifier. Unverified email headers and decoded-but-unverified JWTs are never trusted. Invalid/missing tokens return 401; missing configuration or key-service failure returns 503. No token or verification internals are logged or returned. See [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

Access must protect the **entire hostname**, not only `/api`, so both `/` and `/api/*` require sign-in. The Functions check provides additional protection for alternate Pages URLs even if an edge policy is missed; it does not configure that edge policy itself.

## Local development

Use Node.js 22 or newer. From the repository root:

```bash
npm ci
npm --prefix frontend ci
# Create .dev.vars in the repository root as shown below.
npm run build
npm run dev
```

Create the ignored root `.dev.vars` file with your own token:

```dotenv
FLIGHTLOGGER_API_TOKEN="replace-with-your-token"
LOCAL_ACCESS_DEV=true
```

Open `http://localhost:8788`. Wrangler serves the frontend and Pages Functions together. There is no requirement to log in to Cloudflare or create production resources for local development. Local KV is disk-backed under the root `.wrangler/state` and is ignored by Git; it is separate from remote KV despite using the same namespace identifier. Old ignored files under `worker/`, if still present locally, are not read by Pages dev.

`LOCAL_ACCESS_DEV=true` in the ignored root `.dev.vars` opts into a fixed local identity **only on loopback URLs** (`localhost`, `127.0.0.1`, `[::1]`). It does not accept fake identity headers. Public/custom/preview hostnames cannot use this bypass even if the variable is accidentally supplied. Never add this variable to Pages. Remove it and supply real Access configuration if testing actual JWT validation locally.

Optional frontend hot reload: leave `npm run dev` (Pages) running, then run `npm --prefix frontend run dev` in another terminal. Vite proxies `/api` to local Pages at port 8788. Production bundles do not contain a localhost API fallback. Rebuild the frontend to update the static assets served directly by Pages dev.

Local checks:

```bash
npm run check
npm test
npm --prefix frontend test
npm run build
npm run functions:build
```

Tests use generated test JWTs and mocked JWKS/FlightLogger responses. They do not call production APIs or require real credentials. The Functions build writes only ignored output under `.wrangler/pages-build`.

## Cloudflare Pages settings

Keep the existing Pages Git integration with `1ntray/availogger` and production branch `master`. The project root must be the **repository root**, so Cloudflare finds `functions/`.

| Setting | Value |
| --- | --- |
| Project | `availogger` |
| Production branch | `master` |
| Root directory | repository root (blank or `/`) |
| Build command | `npm ci && cd frontend && npm ci && npm run build` |
| Build output directory | `frontend/dist` |
| Node version | `22` or newer |
| Custom domain | `student.luftfartsfag.no` |

The only build-command addition is the root `npm ci`, needed to install/lock `jose` and Pages tooling before Cloudflare bundles Functions. The frontend build and output directory are preserved. Use the current Pages build system (V2 or later). Root `wrangler.jsonc` becomes the source of truth for its listed settings when deployed; do not overwrite it with `wrangler pages download config` without reviewing the resulting diff. See [Pages configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

`frontend/public/_routes.json` limits Functions invocation to `/api` and `/api/*`. Static calendar assets are served by Pages; Access protects them at the edge.

### KV

The existing namespace ID is `ccce02514a2b44d2a7698529136751fd`, with binding name **`AVAILABILITY_CACHE`**. Root `wrangler.jsonc` reuses this namespace; no new namespace is created. With Wrangler configuration enabled, this binding is managed by that file. Before the first deployment, verify the namespace is in the same Cloudflare account as Pages.

If configuring through the dashboard before adopting the file: **Workers & Pages -> availogger -> Settings -> Bindings -> Add -> KV namespace**, choose the existing namespace and name the binding `AVAILABILITY_CACHE`. Do not create a second cache. Redeploy after binding changes. Preview configuration is separate; if previews are enabled, review their bindings and Access audience too.

### Pages runtime secrets and configuration

Under **Workers & Pages -> availogger -> Settings -> Variables and Secrets -> Add**, select the **Production** environment and add the following encrypted runtime bindings, then redeploy:

| Binding | Value |
| --- | --- |
| `FLIGHTLOGGER_API_TOKEN` | Same FlightLogger token used by the existing Worker |
| `CF_ACCESS_TEAM_DOMAIN` | Your actual team hostname, e.g. `your-team.cloudflareaccess.com` (HTTPS URL also accepted) |
| `CF_ACCESS_AUD` | Application Audience (AUD) from the Access application covering the custom domain |

Use **Encrypt**, then **Save**. The Access hostname/AUD are public configuration values; storing them as encrypted bindings lets the dashboard supply them without hard-coding account values or conflicting with Wrangler-managed plain vars. The FlightLogger token is a secret and must remain encrypted. Set it yourself from your secure source; do not print it or retrieve it into tracked files. See [Pages bindings and secrets](https://developers.cloudflare.com/pages/functions/bindings/).

Do not add `LOCAL_ACCESS_DEV` in production or preview. Do not put any secret in a `VITE_*` variable. `VITE_API_BASE_URL`, `SITE_BASE_PATH` and `ALLOWED_ORIGINS` are not needed. GitHub CI needs no Cloudflare credentials or FlightLogger secret.

Previews should not receive the production FlightLogger secret unless needed and protected. If a separate Access preview application is used, configure its own AUD in the Preview environment. Missing preview configuration fails closed.

## Configure Cloudflare Access

1. Create/confirm your Cloudflare Zero Trust organization and team domain.
2. After confirming the existing Pages custom domain is active, go to **Zero Trust -> Access controls -> Applications -> Create new application -> Self-hosted and private**.
3. Add public hostname `student.luftfartsfag.no`. Leave the path unrestricted to cover the entire site. For a Pages custom hostname with DNS outside Cloudflare, use **Switch to custom input** if it is not in the domain dropdown; do not move the Wix nameservers or change the CNAME. Cloudflare documents this option for SaaS custom hostnames in [Access application setup](https://developers.cloudflare.com/learning-paths/clientless-access/access-application/create-access-app/).
4. Add an **Allow** policy for the intended users/groups and select your identity provider. Access itself can use email one-time PIN if desired; Availogger does not implement that login. Do not add a Bypass policy for API routes. Choose the Access session duration in the dashboard.
5. Copy this application's AUD into the Pages `CF_ACCESS_AUD` binding, and the actual team hostname into `CF_ACCESS_TEAM_DOMAIN`.
6. Protect/redirect `availogger.pages.dev` and preview URLs as well. Pages' preview Access toggle does not by itself protect the custom domain. If additional Access applications are used, their AUDs must match the configuration of the deployment they serve. See [Pages Access caveats](https://developers.cloudflare.com/pages/platform/known-issues/).

No application roles or D1 records are created. Future user records should key off the verified Access subject (and account/team context), not an arbitrary email header.

## Deployment and production verification

1. Configure the Access application, intended-user policy, Pages runtime bindings, KV binding, and build command before the first deployment. Missing Access configuration intentionally returns 401/503 instead of exposing schedules.
2. Run the local checks above, then commit/push changes to `master`. Pages Git integration publishes the frontend and Functions in one deployment. Confirm the Pages build bundles `functions/`; CI must also pass.
3. Open `https://student.luftfartsfag.no/` in a private window. Confirm Access sign-in appears before the calendar and denies an unapproved account.
4. After signing in, open `https://student.luftfartsfag.no/api/me`; check that it returns only your verified email/subject.
5. Open `https://student.luftfartsfag.no/api/availability?from=2026-09-01&to=2026-10-31` (adjust to the current two months). Expect HTTP 200, `timeZone: "Europe/Oslo"`, an ISO `cachedAt`, and correctly sized instructor day arrays. Reload the same range and confirm `cachedAt` is unchanged while cached.
6. In the calendar's Network tab, confirm requests go to **the custom domain's `/api/availability`**, with no workers.dev call. Confirm today/future dates, filters and month navigation still work.
7. From a client without an Access session, run:

   ```bash
   curl -i "https://student.luftfartsfag.no/api/availability?from=2026-09-01&to=2026-10-31"
   ```

   Expect an Access login redirect or a 401 denial, never schedule JSON. Repeat against `https://availogger.pages.dev/api/availability?...` and any enabled preview URL. Check `/` on alternate hostnames too. A forged `Cf-Access-Authenticated-User-Email` must not grant access.
8. If a future deployment fails verification, roll Pages back to a preceding verified deployment containing both the frontend and Functions. Old static-only deployments depended on the deleted Worker. Do not restore an unauthenticated path in the Functions.

Production verification requires the account-specific settings above. Passing local tests/builds alone does not verify a live deployment. The user confirmed the migrated production site loads cached and uncached schedules after the standalone Worker was deleted.

### If `/api/me` displays the calendar instead of JSON

The deployment is serving Pages' SPA HTML fallback for the API URL. This means the Functions route is missing from that deployment; an Access policy change will not fix it. Check **Settings -> Build configuration**: the root directory must be the repository root, the build command must be `npm ci && cd frontend && npm ci && npm run build`, and the output must be `frontend/dist`. Keep `functions/` and `wrangler.jsonc` at the repository root. Confirm the deployed `master` commit includes the four `functions/api/` files and review its build log for Functions compilation. The reference ignore rule must be `/API/` (root only); `API/` can also ignore `functions/api/` on Windows and leave those files out of commits. After committing any missing routes or correcting the build settings, create a new production deployment and retry `/api/me` after signing in. An expired-session message in an older frontend can also mean that the API returned HTML rather than JSON.

## Legacy retirement and retained KV

The old `availogger-api` Worker has been deleted by the user after production verification. Its deployment configuration, package files, routing and CORS code are no longer part of this repository. FlightLogger modules and useful cache/calendar/client tests were moved into `backend/` and `test/`. The application has no workers.dev API dependency.

Keep the separate KV namespace `availogger-api-availability-cache` (ID `ccce02514a2b44d2a7698529136751fd`). The name is historical; Pages continues to bind it as `AVAILABILITY_CACHE`. Deleting the standalone Worker does not require moving or deleting the shared namespace. Keep the Pages `FLIGHTLOGGER_API_TOKEN` secret too. There is no need to export the cache to retire the Worker; successful entries expire after 24 hours and are rebuilt on demand.

The old `.github/workflows/deploy-pages.yml` was removed, so GitHub no longer deploys the frontend to GitHub Pages. In GitHub **Settings -> Pages**, unpublish/disable the old GitHub Pages site if it still exists; deleting a workflow does not unpublish an existing site. Cloudflare Pages Git integration and CI remain active.

## Availability semantics, cache and security

Days use Europe/Oslo boundaries, including 23/25-hour DST days. An unavailable period takes priority over an available overlap. No matching record means no information, not booking-free time.

FlightLogger's documented availability filters select records beginning after `from` and ending before `to`, without an overlap argument. The query retains its 90-day padding on each side. A period starting before the padded boundary or ending after it can be missed even if it overlaps a displayed day. Pagination remains bounded and rejects non-progressing cursors/partial GraphQL errors. See [FlightLogger's reference](https://api.flightlogger.net/).

Successful range results retain their original `cachedAt` in the 24-hour KV cache and up-to-60-second memory cache. Keys include the SHA-256 token hash; the original version/key format is preserved so Pages can reuse the existing entries. Browser responses are `no-store`. Reload view does not force an upstream fetch. KV is eventually consistent; different Cloudflare locations may briefly duplicate a cache miss. FlightLogger 429 handling and its retry delay remain intact.

The FlightLogger token stays server-side. There are no mutations, arbitrary GraphQL queries, raw token/cache-key responses, custom password handling or application sessions. Access's allow policy is the authorization boundary; all approved users currently see the shared account's recorded instructor availability. Protect every hostname, including aliases and previews.

## Next phase

Define an application user foundation keyed by verified Access subject, then choose one operational module (for example Duty Ops). Preserve `FlightLoggerClient(token)` for future encrypted per-user credentials. Business logic, D1, subscriptions, push delivery and roles remain outside this frontend/PWA phase.
