# Availogger

Availogger displays recorded FlightLogger instructor availability. The current view starts today in Europe/Oslo, with future month navigation, fixed instructor names, and available/unavailable/no-information day cells. The application is read-only.

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

Wix hosting and the existing CNAME remain unchanged. The repository implements the Pages API and Access verification. Production migration is only complete after the configuration and verification steps below succeed. The old standalone Worker remains available during migration; **it is still public until you retire it**. No production resources are deleted by this change.

### Source layout

- `frontend/`: React/Vite calendar, same-origin API client, date and cache-age tests.
- `functions/api/`: Pages routes, Access middleware, availability, `/api/me`, and JSON 404 for unknown API routes.
- `backend/availability.ts`: shared date validation, cache, response mapping and safe errors.
- `backend/access.ts`: verified Access identity, reusable for future D1 user mapping.
- `worker/src/flightlogger/`: existing client, fixed queries, pagination protection and Oslo calendar calculations. Pages imports these modules directly; there is no second FlightLogger implementation.
- `worker/src/index.ts` and `worker/wrangler.jsonc`: temporary legacy Worker wrapper/config for rollback. Their CORS settings do not apply to Pages.
- `test/`: Pages route and Access verification tests. Existing `worker/test/` tests also run from the root.
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
cp .dev.vars.example .dev.vars
# Edit .dev.vars and set your FlightLogger token.
npm run build
npm run dev
```

On PowerShell use `Copy-Item .dev.vars.example .dev.vars` instead of `cp`. Open `http://localhost:8788`. Wrangler serves the frontend and Pages Functions together. There is no requirement to log in to Cloudflare or create production resources for local development. Local KV is disk-backed under the root `.wrangler/state` and is ignored by Git; it is separate from remote KV despite using the same namespace identifier.

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
| Node version | `22` (`NODE_VERSION` build variable if needed) |
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

Use **Encrypt**, then **Save**. The Access hostname/AUD are public configuration values; storing them as encrypted bindings lets the dashboard supply them without hard-coding account values or conflicting with Wrangler-managed plain vars. The FlightLogger token is a secret and must remain encrypted. A standalone Worker's secret is **not copied automatically** into Pages. Set it yourself from your secure source; do not print it or retrieve it into tracked files. See [Pages bindings and secrets](https://developers.cloudflare.com/pages/functions/bindings/).

Do not add `LOCAL_ACCESS_DEV` in production or preview. Do not put any secret in a `VITE_*` variable. Remove obsolete `VITE_API_BASE_URL` and `SITE_BASE_PATH` values from Pages/GitHub when convenient; the frontend ignores them. `ALLOWED_ORIGINS` is not needed in Pages. GitHub CI needs no Cloudflare credentials or FlightLogger secret. Existing Worker secrets remain untouched until migration is verified.

Previews should not receive the production FlightLogger secret unless needed and protected. If a separate Access preview application is used, configure its own AUD in the Preview environment. Missing preview configuration fails closed.

## Configure Cloudflare Access

1. Create/confirm your Cloudflare Zero Trust organization and team domain.
2. After confirming the existing Pages custom domain is active, go to **Zero Trust -> Access controls -> Applications -> Create new application -> Self-hosted and private**.
3. Add public hostname `student.luftfartsfag.no`. Leave the path unrestricted to cover the entire site. For a Pages custom hostname with DNS outside Cloudflare, use **Switch to custom input** if it is not in the domain dropdown; do not move the Wix nameservers or change the CNAME. Cloudflare documents this option for SaaS custom hostnames in [Access application setup](https://developers.cloudflare.com/learning-paths/clientless-access/access-application/create-access-app/).
4. Add an **Allow** policy for the intended users/groups and select your identity provider. Access itself can use email one-time PIN if desired; Availogger does not implement that login. Do not add a Bypass policy for API routes. Choose the Access session duration in the dashboard.
5. Copy this application's AUD into the Pages `CF_ACCESS_AUD` binding, and the actual team hostname into `CF_ACCESS_TEAM_DOMAIN`.
6. Protect/redirect `availogger.pages.dev` and preview URLs as well. Pages' preview Access toggle does not by itself protect the custom domain. If additional Access applications are used, their AUDs must match the configuration of the deployment they serve. See [Pages Access caveats](https://developers.cloudflare.com/pages/platform/known-issues/).

No application roles or D1 records are created. Future user records should key off the verified Access subject (and account/team context), not an arbitrary email header.

## One-time deployment and production verification

1. Configure the Access application, intended-user policy, Pages runtime bindings, KV binding, and updated build command **before pushing the migration to `master`**. Until these are ready, the new API intentionally returns 401/503 instead of exposing schedules.
2. Run the local checks above. Commit/push the migration. Pages Git integration publishes the frontend and Functions in one deployment. Confirm the Pages build bundles `functions/`; CI must also pass.
3. Open `https://student.luftfartsfag.no/` in a private window. Confirm Access sign-in appears before the calendar and denies an unapproved account.
4. After signing in, open `https://student.luftfartsfag.no/api/me`; check that it returns only your verified email/subject.
5. Open `https://student.luftfartsfag.no/api/availability?from=2026-09-01&to=2026-10-31` (adjust to the current two months). Expect HTTP 200, `timeZone: "Europe/Oslo"`, an ISO `cachedAt`, and correctly sized instructor day arrays. Reload the same range and confirm `cachedAt` is unchanged while cached.
6. In the calendar's Network tab, confirm requests go to **the custom domain's `/api/availability`**, with no workers.dev call. Confirm today/future dates, filters and month navigation still work.
7. From a client without an Access session, run:

   ```bash
   curl -i "https://student.luftfartsfag.no/api/availability?from=2026-09-01&to=2026-10-31"
   ```

   Expect an Access login redirect or a 401 denial, never schedule JSON. Repeat against `https://availogger.pages.dev/api/availability?...` and any enabled preview URL. Check `/` on alternate hostnames too. A forged `Cf-Access-Authenticated-User-Email` must not grant access.
8. If verification fails, keep the old Worker and use Pages' rollback to the preceding deployment while correcting configuration. Do not restore an unauthenticated path in the new Functions.

Production verification has to be performed after these manual account-specific settings are supplied. Passing local tests/builds alone does not mean the live migration is complete.

## Retire the old production path after verification

1. Confirm the new Pages deployment is stable and no frontend/network/configuration still references `availogger-api.lundell-simon-05.workers.dev`.
2. In **Workers & Pages -> availogger-api -> Settings -> Domains & Routes**, disable its `workers.dev` route and any other routes. Test that the old URL cannot return schedule data. Do not delete the shared KV namespace.
3. After the desired rollback window, delete the standalone `availogger-api` Worker in the dashboard, which also removes its old secret. Keep the Pages token and existing KV.
4. In a follow-up code cleanup, remove legacy `worker/src/index.ts`, `worker/wrangler.jsonc`, `worker/package.json`, `worker/package-lock.json`, `worker/tsconfig.json`, and legacy `worker/test/routes.test.ts`. Preserve the reused FlightLogger modules and their client/calendar tests (move them first if reorganizing paths). Do not delete the whole `worker/` directory while Pages still imports it.
5. `.github/workflows/deploy-pages.yml` has already been removed by this migration, so pushing it stops future GitHub Pages deployments. In GitHub **Settings -> Pages**, unpublish/disable the old GitHub Pages site if it still exists; deleting a workflow does not unpublish an existing site. The old static bundle may continue calling the legacy API until that API is disabled.

## Availability semantics, cache and security

Days use Europe/Oslo boundaries, including 23/25-hour DST days. An unavailable period takes priority over an available overlap. No matching record means no information, not booking-free time.

FlightLogger's documented availability filters select records beginning after `from` and ending before `to`, without an overlap argument. The query retains its 90-day padding on each side. A period starting before the padded boundary or ending after it can be missed even if it overlaps a displayed day. Pagination remains bounded and rejects non-progressing cursors/partial GraphQL errors. See [FlightLogger's reference](https://api.flightlogger.net/).

Successful range results retain their original `cachedAt` in the 24-hour KV cache and up-to-60-second memory cache. Keys include the SHA-256 token hash; the original version/key format is preserved so Pages can reuse the existing entries. Browser responses are `no-store`. Reload view does not force an upstream fetch. KV is eventually consistent; different Cloudflare locations may briefly duplicate a cache miss. FlightLogger 429 handling and its retry delay remain intact.

The FlightLogger token stays server-side. There are no mutations, arbitrary GraphQL queries, raw token/cache-key responses, custom password handling or application sessions. Access's allow policy is the authorization boundary; all approved users currently see the shared account's recorded instructor availability. Protect every hostname and retire the legacy Worker before considering the old public-data path closed.

## Next phase

Map verified Access subjects to D1 application users, then consider encrypted per-user FlightLogger credentials. Preserve `FlightLoggerClient(token)` for that transition. Personal schedules, Duty Ops, swaps and advanced queries remain out of scope.
