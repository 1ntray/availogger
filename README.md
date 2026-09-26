# Availogger

Availogger Phase 1 displays FlightLogger flight instructor availability in a two-month calendar. Names stay visible while dates scroll. Each day is marked **available**, **unavailable**, or **no information**. The app is read-only and has no user accounts.

## Architecture

`GitHub Pages (React/Vite) → Cloudflare Worker (REST API) → FlightLogger GraphQL`

The browser calls only `/api/instructors` and `/api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD` on the Worker. The Worker owns the fixed GraphQL queries and converts FlightLogger records to daily app statuses. The API token exists only in Cloudflare's secret binding or a local, ignored `worker/.dev.vars` file. No database is used.

The `API/` directory in this workspace is the **separate, existing Streamlit reference repository**. It is ignored by the new root repository and is not part of the new application or Pages artifact. Do not copy its `.streamlit` secrets into the new repository.

## Structure

- `frontend/`: React, TypeScript, Vite calendar and API client.
- `worker/`: Cloudflare Worker, fixed FlightLogger queries, response mapping, date calculations, API routes.
- `.github/workflows/deploy-pages.yml`: GitHub Pages build and deployment.

## Local development

Install Node.js 22 or newer. In separate terminals, from the new repository root:

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

The Worker expects a FlightLogger token authorized to read active users and their availabilities. Its GraphQL endpoint is `https://api.flightlogger.net/graphql` using `Authorization: Bearer <token>`. You can check the API without the frontend:

```bash
curl "http://localhost:8787/api/availability?from=2026-09-01&to=2026-09-30"
```

The `from` and `to` values are inclusive calendar dates. The maximum range is 62 days. The returned `days` array has one status per date, in order, interpreted in `Europe/Oslo`. An unavailable record takes priority over an available record when both overlap a day.

Run checks with `npm run build` in `frontend/` and `npm run check && npm test` in `worker/`.

## Deploy the Worker

1. Create or sign in to a Cloudflare account and enable Workers. Configure a `workers.dev` subdomain if Cloudflare prompts you.
2. In `worker/wrangler.jsonc`, set `ALLOWED_ORIGINS` to your actual Pages **origin**, such as `https://YOUR-USERNAME.github.io`. Keep `http://localhost:5173` as a comma-separated second origin if you will test locally against the deployed Worker. A custom domain uses its own origin. This value is public and is not a secret.
3. From `worker/`, run:

   ```bash
   npm ci
   npx wrangler login
   npx wrangler secret put FLIGHTLOGGER_API_TOKEN
   npx wrangler deploy
   ```

   Enter the token at Wrangler's interactive prompt; never pass it on the command line. `secret put` may create and deploy the Worker before the final deploy command. Wrangler validates the declared required secret on deployment.
4. Copy the public Worker URL (`https://availogger-api.<your-subdomain>.workers.dev`) from Wrangler's output. Test `/api/instructors` and a short `/api/availability` range. Confirm the response contains expected instructors and statuses before publishing the frontend.

The Worker name is set in `worker/wrangler.jsonc`. Change it there if it conflicts with another Worker. No Cloudflare database or storage setup is required.

## Deploy the frontend to GitHub Pages

1. Create a **new, empty GitHub repository** for this root project. The old `API/` repository is only a reference. Check `git status` before pushing: `API/`, `worker/.dev.vars`, and `frontend/.env.local` must stay ignored. From the root, connect and push the new repository (replace the URL with yours):

   ```bash
   git add .
   git commit -m "Build Availogger Phase 1"
   git branch -M main
   git remote add origin git@github.com:YOUR-USERNAME/YOUR-NEW-REPOSITORY.git
   git push -u origin main
   ```
2. In the new repository, go to **Settings → Pages → Build and deployment** and choose **GitHub Actions** as the source.
3. In **Settings → Secrets and variables → Actions → Variables**, add `VITE_API_BASE_URL` with the public Worker URL (no `/api` suffix). It is intentionally public. The workflow uses the repository name as Vite's base path automatically. If you use a custom domain or a `USERNAME.github.io` repository, add `SITE_BASE_PATH` set to `/`.
4. Push to `main` or run **Deploy frontend to GitHub Pages** under Actions. The workflow builds only `frontend/` and uploads only `frontend/dist`.
5. Open the Pages URL and confirm the calendar loads. If you change the Pages hostname or custom domain, update `ALLOWED_ORIGINS` in `worker/wrangler.jsonc` and redeploy the Worker.

For local builds against a different backend, put `VITE_API_BASE_URL=https://your-worker.workers.dev` in `frontend/.env.local`. This variable contains a public URL. **Never put the FlightLogger token in any `VITE_` variable or GitHub repository variable.**

## API and security notes

The implementation reuses the old app's `users(roles: [FLIGHT_INSTRUCTOR])` cursor pagination and `user(id).availabilities` pagination. It also selects the documented availability connection inside each user in the instructor list query to reduce network calls. The response mapping validates the shape, rejects GraphQL partial errors, and fails if pagination stops progressing. Queries and roles are fixed server-side; callers cannot submit GraphQL.

FlightLogger documents `FLIGHT_INSTRUCTOR`, `STUDENT`, and other user role enum values; Phase 1 deliberately requests only `FLIGHT_INSTRUCTOR`. The API returns `startsAt`, `endsAt`, and `unavailable`. There is no separate status field on an availability record. See the [official FlightLogger API reference](https://api.flightlogger.net/).

**The Worker API is public.** CORS limits which browser origins may read it, but CORS is not authentication: a direct HTTP client can still call it. This means instructor names and availability are public to anyone with the URL. Do not deploy with a token/account whose availability data is not approved for public viewing. Add real access control before using private personal schedules or multi-user tokens. The token itself remains server-side. The Worker does not log the token or raw API responses.

Dates are validated, the range is limited to 62 days, and the Worker stops before Cloudflare Free's 50 external subrequest limit. Large or unusually deep availability connections return an explicit error instead of incomplete data. The API's documented `from`/`to` filters select events whose start and end fall inside the query window. The Worker pads that window by 90 days on either side to catch common spanning periods; an event longer than that may still be omitted. If FlightLogger clarifies or adds true overlap filtering for availability, update this query. The calendar means **recorded availability**, not booking-free time.

The API uses `Cache-Control: no-store` for browser responses. To reduce repeated FlightLogger calls, each Worker instance keeps successful date-range results in memory for up to one minute; the Refresh button may show data from that short cache. FlightLogger HTTP 429 responses are shown as rate limits with a retry delay, and the Worker pauses new upstream requests during that delay. This is a small Phase 1 safeguard, not a shared or durable quota manager. Add authentication and stronger rate limiting before wider use.

## Phase 1 limits and future work

There are no accounts, personal tokens, bookings, Duty Ops assignments, shift swaps, writes, notifications, or database. A future phase can add authentication and per-user server-side token storage, then private schedules and Duty Ops workflows behind authorized API routes.
