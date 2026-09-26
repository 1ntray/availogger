# Availogger

Availogger Phase 1 displays FlightLogger flight instructor availability in a two-month calendar. Names stay visible while dates scroll. Each day is marked **available**, **unavailable**, or **no information**. The app is read-only and has no user accounts.

## Architecture

`GitHub Pages (React/Vite) → Cloudflare Worker (REST API) → FlightLogger GraphQL`

The browser calls only `/api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD` on the Worker. The Worker owns the fixed GraphQL queries and converts FlightLogger records to daily app statuses. Its unused public `/api/instructors` route has been removed; the internal FlightLogger client still has an instructor-list method. The API token exists only in Cloudflare's secret binding or a local, ignored `worker/.dev.vars` file. Cloudflare KV stores successful availability responses for one day; Wrangler uses local disk-backed KV during development.

The `API/` directory in this workspace is the **separate, existing Streamlit reference repository**. It is ignored by this repository and is not part of Availogger or the Pages artifact. Do not copy its `.streamlit` secrets here.

## Structure

- `frontend/`: React, TypeScript, Vite calendar and API client.
- `worker/`: Cloudflare Worker, fixed FlightLogger queries, response mapping, date calculations, API routes.
- `.github/workflows/deploy-pages.yml`: GitHub Pages build and deployment.
- `.github/workflows/ci.yml`: frontend and Worker checks on pull requests and pushes to `master`.

## Local development

Install Node.js 22 or newer. In separate terminals, from this repository root:

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars and replace the placeholder with your FlightLogger token.
npm run dev
```

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

The frontend defaults to `http://localhost:8787` and the Worker permits `http://localhost:5173`. Open the Vite URL shown by `npm run dev`. On Windows PowerShell, use `Copy-Item .dev.vars.example .dev.vars` and `Copy-Item .env.example .env.local` in place of `cp`.

Wrangler creates the local KV cache automatically in `worker/.wrangler/state`. It survives restarting the local Worker and is ignored by Git. Delete `worker/.wrangler/state` if you need to clear the local cache. Local KV data is separate from deployed KV data.

The Worker expects a FlightLogger token authorized to read active users and their availabilities. Its GraphQL endpoint is `https://api.flightlogger.net/graphql` using `Authorization: Bearer <token>`. You can check the API without the frontend:

```bash
curl "http://localhost:8787/api/availability?from=2026-09-01&to=2026-09-30"
```

The `from` and `to` values are inclusive calendar dates. The maximum range is 62 days. The returned `days` array has one status per date, in order, interpreted in `Europe/Oslo`. An unavailable record takes priority over an available record when both overlap a day. Successful responses also include `cachedAt`, an ISO 8601 UTC timestamp showing when that schedule was fetched from FlightLogger. The page displays its relative age and shows the exact Europe/Oslo time when hovered.

Run `npm test` and `npm run build` in `frontend/`; run `npm run check` and `npm test` in `worker/`. GitHub Actions runs these checks with Node 22 on pull requests and pushes to `master`, using only mocked FlightLogger responses.

## Deploy the Worker

The Worker and its `AVAILABILITY_CACHE` KV namespace are already configured in `worker/wrangler.jsonc`. To deploy Worker code changes:

1. Confirm `ALLOWED_ORIGINS` contains the actual Pages **origin** and any local origin needed for testing. The current values are `https://1ntray.github.io` and `http://localhost:5173`. A custom domain uses its own origin. This value is public and is not a secret.
2. From `worker/`, run:

   ```bash
   npm ci
   npx wrangler deploy
   ```

   If Wrangler asks you to authenticate, run `npx wrangler login`. The deployed Worker also requires the existing `FLIGHTLOGGER_API_TOKEN` secret. If setting up a new Cloudflare account, use `npx wrangler secret put FLIGHTLOGGER_API_TOKEN` and enter it at the interactive prompt; never pass the token on the command line.
3. Test a short `/api/availability` range at the public Worker URL. Confirm the response contains expected instructors, statuses, and `cachedAt` before publishing the frontend.

The Worker name is set in `worker/wrangler.jsonc`. Change it there if it conflicts with another Worker. No separate KV creation command is required with the included Wrangler version.

## Deploy the frontend to GitHub Pages

The existing repository is [1ntray/availogger](https://github.com/1ntray/availogger), on `master`. GitHub Pages uses `.github/workflows/deploy-pages.yml`; its source should be **GitHub Actions** under **Settings → Pages → Build and deployment**. The repository variable `VITE_API_BASE_URL` must contain the public Worker URL without `/api`. It is intentionally public. The workflow derives Vite's base path from the repository name; a custom domain can use `SITE_BASE_PATH=/`.

Push frontend changes to `master` or run **Deploy frontend to GitHub Pages** under Actions. The workflow builds only `frontend/` and uploads only `frontend/dist`. Worker changes require the separate Wrangler deployment above. After deployment, open the Pages URL and confirm the calendar and updated timestamp load. If the Pages hostname or custom domain changes, update `ALLOWED_ORIGINS` in `worker/wrangler.jsonc` and redeploy the Worker.

Deploy the Worker before Pages when an API response changes. The frontend also accepts schedules from older Workers without `cachedAt`, displaying “Update time unavailable” until the Worker is updated. It never substitutes the page load time for the actual fetch time.

For local builds against a different backend, put `VITE_API_BASE_URL=https://your-worker.workers.dev` in `frontend/.env.local`. This variable contains a public URL. **Never put the FlightLogger token in any `VITE_` variable or GitHub repository variable.**

## API and security notes

The implementation reuses the old app's `users(roles: [FLIGHT_INSTRUCTOR])` cursor pagination and `user(id).availabilities` pagination. It also selects the documented availability connection inside each user in the instructor list query to reduce network calls. The response mapping validates the shape, rejects GraphQL partial errors, and fails if pagination stops progressing. Queries and roles are fixed server-side; callers cannot submit GraphQL.

FlightLogger documents `FLIGHT_INSTRUCTOR`, `STUDENT`, and other user role enum values; Phase 1 deliberately requests only `FLIGHT_INSTRUCTOR`. The API returns `startsAt`, `endsAt`, and `unavailable`. There is no separate status field on an availability record. See the [official FlightLogger API reference](https://api.flightlogger.net/).

**The Worker API is public.** CORS limits which browser origins may read it, but CORS is not authentication: a direct HTTP client can still call it. This means instructor names and availability are public to anyone with the URL. Do not deploy with a token/account whose availability data is not approved for public viewing. Add real access control before using private personal schedules or multi-user tokens. The token itself remains server-side. The Worker does not log the token or raw API responses.

Dates are validated, the range is limited to 62 days, and the Worker stops before Cloudflare Free's 50 external subrequest limit. Large or unusually deep availability connections return an explicit error instead of incomplete data. FlightLogger's documented availability `from` filter selects events beginning after the query boundary, and `to` selects events ending before it; no overlap argument is documented for this connection. The Worker pads the query by 90 days on either side to catch common spanning periods. A period that starts before the padded start or ends after the padded end can still be omitted, even if it overlaps a requested day. If FlightLogger adds an overlap filter, revisit this query. The calendar means **recorded availability**, not booking-free time.

The API uses `Cache-Control: no-store` for browser responses. Successful date-range results are stored in KV for 24 hours and also held in Worker memory for up to one minute. The same `cachedAt` value is retained on memory and KV hits; only a fresh FlightLogger fetch creates a new timestamp. Cache keys include a SHA-256 hash of the FlightLogger token, so replacing the token does not reuse another account's schedule. The page's **Reload view** button reloads the current cached result; it does not force a FlightLogger call. KV data is shared across deployed Worker instances and stored on disk by local Wrangler. FlightLogger HTTP 429 responses are shown as rate limits with a retry delay, and the Worker pauses new upstream requests during that delay. KV is eventually consistent, so a newly cached range may still cause a small number of duplicate FlightLogger requests from different Cloudflare locations. Before adding manual force refresh, add authentication and reassess cache duration and rate limiting.

## Phase 1 limits and future work

There are no accounts, personal tokens, bookings, Duty Ops assignments, shift swaps, schedule writes, notifications, or SQL database. A future phase can add authentication and per-user server-side token storage, then private schedules and Duty Ops workflows behind authorized API routes.
