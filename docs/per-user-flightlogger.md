# Per-user FlightLogger rollout — complete setup before merging

This feature branch requires **D1 + DB + an encryption secret**. `master` auto-deploys Pages. **Do not merge yet:** this work does not create production resources, apply remote migrations or verify a live deployment. The old shared secret remains externally configured, but is never a fallback in the new code.

Current setup progress: the user created `studentportal-db`, and a read-only Cloudflare check confirmed UUID `a6a29063-bacf-454f-8423-5e956e769e5f`. That real ID is now configured as `DB` on the feature branch. The production migration and encryption secret remain pending. Preview D1/KV bindings are explicitly empty so previews cannot inherit the production resources.

## Implementation report

Verified Access subject -> parameterized D1 user resolution -> mandatory onboarding -> validated personal credential -> AES-256-GCM encryption -> transactional credential/user-ID save. Availability decrypts only the current user's credential before the retained token-hashed cache.

Added: SQL migration; user/encryption/credential/request/application services; onboarding POST/page/gates; credential form/API/CSS; separate local Wrangler config; local migration commands; D1/security/UI tests; this guide and secret-format example. Changed: environment types, explicit-token availability service, FlightLogger validation query/cooldowns/safe errors, `/api/me`, availability route, CurrentUser refresh/state, existing router gates, Settings panel and README. No existing shell, navigation, Home, PWA or production infrastructure is removed.

## Manual Cloudflare setup BEFORE merge

Use the feature branch with Node 22+ and locked dependencies. Authenticate Wrangler to the **same account as Pages**, using `npx wrangler login` if needed. Remote commands below are for the administrator after reviewing the account/resource; they were not run automatically.

1. Create D1 **`studentportal-db`** under Cloudflare **Storage & databases -> D1 -> Create database**, or:

   ```bash
   npx wrangler d1 create studentportal-db
   ```

   Copy the actual database UUID from creation output/dashboard details. Do not use a made-up ID.

2. **Workers & Pages -> availogger -> Settings -> Bindings -> Add -> D1 database**: select that database and name the Production binding **`DB`**, if dashboard editing is available. This additive binding is unused by the old deployed code. If the controls are read-only because Wrangler manages bindings, configure `DB` in step 3 instead; Pages applies that file's binding with the deployment. Database/schema/secret must already exist before that deployment activates.

3. Add the same binding to the **feature branch's root `wrangler.jsonc`**, with the actual UUID:

   ```jsonc
   "d1_databases": [
     {
       "binding": "DB",
       "database_name": "studentportal-db",
       "database_id": "COPY_THE_ACTUAL_DATABASE_UUID_HERE",
       "migrations_dir": "./migrations"
     }
   ]
   ```

   This is a documentation template, not an ID to commit. Add commas as needed; retain the existing KV ID, project name, compatibility date and output directory. Wrangler is the configuration source of truth: the real binding must be committed before merge, not only added in the dashboard. Do not replace the whole config with a dashboard download.

4. Apply and confirm the additive schema **before activation**:

   ```bash
   npm ci
   npx wrangler d1 migrations list studentportal-db --remote --config wrangler.jsonc
   npx wrangler d1 migrations apply studentportal-db --remote --config wrangler.jsonc
   npx wrangler d1 migrations list studentportal-db --remote --config wrangler.jsonc
   ```

   Review the named account/database and migration prompt. Confirm `0001_application_users.sql` was applied. No destructive migration is included. If tables already exist, review the SQL and use a dedicated portal database rather than assuming it is blank.

5. Generate **a new production key**, distinct from local, on a trusted machine:

   ```bash
   node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   Store a backup securely. Do not paste output into Git, screenshots/chat/CI logs or a Vite variable. It is padded standard Base64 of exactly 32 random bytes. Under **Workers & Pages -> availogger -> Settings -> Variables and Secrets -> Add**, select **Production**, name **`FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY`**, choose **Secret/Encrypt**, paste/save. Keep existing Access hostname/AUD secrets. This encryption key is not a FlightLogger API key.

6. Keep Access protecting the entire custom hostname, including `/onboarding` and `/api/*`. Confirm `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and existing KV binding. Never set `LOCAL_ACCESS_DEV` on Pages. **Disable automatic preview deployments under Pages Settings -> Build -> Branch control until a separate preview environment is configured**, or explicitly bind a different real database under `env.preview.d1_databases` and use a separate Preview key/Access audience. Top-level bindings can apply to previews too: do not rely on the branch name to isolate production D1. Do not expose production DB/key through untrusted previews. Without required resources a preview correctly fails closed.

7. Commit the real DB binding **on this feature branch**, rerun checks and merge only after steps 1–6. Existing Git integration deploys `master`. Retain repository-root build, command `npm ci && cd frontend && npm ci && npm run build`, output `frontend/dist`. Confirm a successful frontend + Functions deployment from the intended commit. No standalone Worker/redundant GitHub Pages workflow is required.

Official references: [Pages D1 bindings](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases), [Pages Wrangler config](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/).

## Production verification AFTER deployment

1. Private window -> custom domain -> confirm Access sign-in/allow policy. An unapproved account must not receive protected API data.
2. A new approved user goes to `/onboarding`. Direct normal routes must not bypass it. After sign-in, `/api/me` must return JSON with verified email/subject, both onboarding/credential booleans false and `flightLoggerUserId: null`.
3. Submit an invalid personal key: safe verification error, no credential or FlightLogger user ID saved. Do not include real keys in diagnostics.
4. Submit a valid key: safe connect metadata, automatic Home navigation. `/api/me` now reports both booleans true and FlightLogger user ID. Never token/ciphertext/IV/encryption-version/JWT.
5. Open Availability and a **previously uncached future range**. Check search/today/month navigation, same-origin `/api/availability`, HTTP 200, Europe/Oslo and valid `cachedAt`. Reload keeps its timestamp. No workers.dev or shared-token fallback.
6. Settings -> invalid replacement must preserve the current connection; then valid replacement -> verify an uncached range again. The old key must never be shown. This checks decrypt/storage, not only cache hits.
7. Repeat with a second approved Access subject/personal key and verify its permissions/data. Equal emails/different subjects must remain separate D1 users; each writes only their own connection.
8. Refresh direct routes, check desktop/mobile/PWA install/update. Cache Storage must contain **only static assets**, no `/api/*`, credentials, identity, HTML or Access pages. Key submissions must use POST bodies, never URL/history. Do not copy bodies/cookies into diagnostics.
9. Without an Access session, check me/availability/onboarding on custom/alternate/preview hosts. Expect Access redirect or 401, never protected JSON. Forged email headers cannot grant access. Protect alternate frontend hosts too.
10. **Only after onboarding, replacement and uncached schedules work**, manually remove `FLIGHTLOGGER_API_TOKEN` from Pages Production secrets. Remove the obsolete local `.dev.vars` entry yourself after local verification. Redeploy if required and verify an uncached range again. Keep the encryption key, `DB`, Access config and existing KV.

## Local setup (no production resources)

```bash
npm ci
npm --prefix frontend ci
npm run db:migrate:local
npm run db:status:local
npm run build
npm run dev
```

Create/update ignored root `.dev.vars` yourself: `LOCAL_ACCESS_DEV=true` plus a separately generated `FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY`. No shared token required. Open `http://localhost:8788`; the fixed local Access identity uses the same D1/onboarding flow. `wrangler.local.jsonc` binds local D1/KV with `remote: false`, no production DB ID and persistent ignored state. Keep the same key while retaining local credentials.

Checks: `npm run check`, `npm test`, `npm --prefix frontend test`, `npm run build`, `npm run functions:build`. Tests use real schema/transaction rollback in disposable local D1 plus mocked FlightLogger/JWT and UI tests; never production services/secrets.

## Recovery and limitations

- Keep the production key stable/backed up. Restore the original after accidental change, or users must replace credentials under a new valid key. No automatic rotation/plaintext recovery. Changing Access teams/subjects is an identity migration, not an email merge.
- A valid but wrong encryption key allows account/Settings and fails availability decryption; missing/malformed key blocks account operations until repaired.
- On failed rollout, roll Pages back to the preceding verified portal while the shared secret remains configured. Leave additive D1 schema/data/key intact. After secret retirement, the old deployment would need it restored by the administrator. Never bypass Access or decrypt in the browser.
- Connected reports stored presence, not ongoing upstream health. Revoked keys may retain 24-hour cached schedules. Different tokens isolate caches; identical tokens intentionally share account cache. Cross-location misses may duplicate calls.
- No roles, key rotation, disconnect/delete UI, personal schedules, push or operational modules are added. Live account/device verification remains manual; local checks alone do not establish production readiness.

## Verification performed on the feature branch

Clean root/frontend `npm ci`, backend TypeScript checks, **89 backend tests**, **38 frontend tests** (10 Node + 28 Vitest), frontend TypeScript/Vite/PWA production build and Pages Functions compilation pass. The initial migration was applied and status verified **locally only**. Browser checks in headless Edge at 1440px desktop and 390px phone verify onboarding, replacement, retained navigation, no horizontal page overflow and static-only service-worker caches with no browser credential persistence. These checks use synthetic local API fixtures, not production identities/keys. No source files were removed, and the shell, navigation, Home and PWA implementations remain intact.
