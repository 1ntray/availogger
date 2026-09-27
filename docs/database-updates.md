# Database updates

D1 migrations are versioned SQL files under `migrations/`. Wrangler applies pending migrations and records completed files in `d1_migrations`; repeated runs do not reapply completed files. A failed migration rolls back that migration; earlier successful migrations remain applied. Review pending SQL and the target database before updating. See [Cloudflare's migration commands](https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply).

## Commands

Run from the repository root in a checkout containing the reviewed migrations, after `npm ci`. Authenticate Wrangler with `npx wrangler login` on your own computer, or provide CI credentials as described below.

| Target | Database | Apply pending files | List pending files |
| --- | --- | --- | --- |
| Local | Isolated local `DB` | `npm run db:migrate:local` | `npm run db:status:local` |
| Preview | `studentportal-preview` | `npm run db:migrate:preview` | `npm run db:status:preview` |
| Production | `studentportal-db` | `npm run db:migrate:production` | `npm run db:status:production` |

Preview/production scripts explicitly name the database and use root `wrangler.jsonc`; preview also selects `--env preview`. Local continues to use `wrangler.local.jsonc` without remote access. After a successful update, the status command should report no migrations to apply. These scripts update the database only; they do not deploy Pages, modify Access or change credentials/bindings.

## Troubleshooting `0005_transport.sql`: incomplete input

If remote preview reports `incomplete input: SQLITE_ERROR` for `0005_transport.sql`, update your checkout to the reviewed fix before retrying `npm run db:migrate:preview`. Then run `npm run db:status:preview` to check that no migrations remain pending. Do not delete migration history or manually mark the file as applied.

The corrected passenger trigger uses conditional `SELECT RAISE(...) WHERE ...` statements instead of nested `CASE ... END`, preserving the same driver, ride availability and seat capacity checks. Remote D1 has reported [trigger parsing problems with nested CASE expressions](https://github.com/cloudflare/workers-sdk/issues/4727) and [CRLF migration files](https://github.com/cloudflare/workers-sdk/issues/14991), even when local SQLite accepts the SQL. `.gitattributes` keeps migration SQL on LF line endings in Windows checkouts.

This corrects the SQL representation in the pending migration; it does not add another schema version. Databases that already applied `0005` keep their equivalent existing trigger and do not reapply it. A failed migration remains pending, and earlier completed migrations remain applied. Local tests cannot prove remote parser compatibility: verify the retry on preview before any production release.

## GitHub setup: one time

### 1. Make the workflow available

The workflow is `.github/workflows/update-database.yml`, named **Update database**. It runs only on manual `workflow_dispatch`; neither opening a PR nor merging one automatically updates a remote database. Normal CI tests migrations in disposable local D1.

GitHub requires this workflow file on the repository's **default branch** before it can be dispatched or show its Run workflow button. This repository's default branch is `master`. Review/merge the tooling PR into **develop** first, then promote the reviewed workflow/scripts through the normal release to `master`. Merging into develop alone makes the npm scripts available there, but does not activate the button. Do not change the repository's default branch just to enable it. See [GitHub manual workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

### 2. Create the GitHub environments

In **GitHub → 1ntray/availogger → Settings → Environments**, create:

- `database-preview`
- `database-production`

Set deployment branch rules for `database-preview` to allow `develop` and `master`. Set `database-production` to allow only `master`. These rules apply to the workflow's **Branch** selection, not its migration-source choice. Environment protection/reviewer options depend on your GitHub plan and repository visibility; use required reviewers for production if desired and available. See [GitHub environment controls](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

### 3. Add Cloudflare credentials to each environment

Create a Cloudflare API token in **Cloudflare → My Profile → API Tokens → Create Token → Custom token**:

- Account permission: **D1 → Edit** (called **D1 Write** in API permission lists).
- Account resources: select only the account containing these databases.
- It does not need Pages, Access, Workers deployment, KV, DNS or FlightLogger permissions.

The D1 permission is account-scoped; separate token values do not by themselves isolate two databases in the same account. The explicit targets and workflow/environment branch rules prevent normal accidental cross-environment use. See [Cloudflare API permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).

Under **Environment secrets** for each GitHub environment, add:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare token with D1 write permission |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID, not a D1 database ID |

Find the account ID in the Cloudflare account dashboard/Workers & Pages account details. Keep these secrets in GitHub environments; do not put them in repository files, a `VITE_*` variable or a PR. Existing Pages runtime secrets remain unchanged. See [Cloudflare CI credentials](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/#2-set-up-cicd).

## Use the GitHub button

1. Open **GitHub → Actions → Update database → Run workflow**.
2. Set **Branch** to `master` for production. For preview, `master` or `develop` is supported once the workflow exists on master.
3. Choose **Database to update**: `preview` or `production` (preview is the default).
4. Choose **Reviewed branch containing the migrations**: `develop` or `master`. Use `develop` for reviewed migrations awaiting production release; use `master` to catch up with an already released version.
5. Click **Run workflow** and open the run to inspect its result.

The workflow validates the target/source before the migration job starts. Feature branches and tags cannot run it; production requires the trusted `master` workflow. Only reviewed branch choices are supported.

The validation job resolves the chosen source to a commit SHA. The update job uses that exact revision, even if develop moves while the job waits for environment approval. Confirm the SHA matches the reviewed release. Updates for the same target are serialized; a newer run never interrupts a running migration. The job lists pending files, applies them, then lists them again. It fails if credentials are missing or Wrangler fails, and records the source SHA in the run summary. Credentials are available only to the remote migration step in the selected environment.

## Release order

Cloudflare Pages Git integration is unchanged and runs independently of this manual workflow. A separate GitHub job triggered after a merge would not guarantee that the database updates before Pages deploys.

- **Preview:** apply reviewed migrations to preview before deploying Functions that need them. Before tooling reaches master, use the npm script from the reviewed feature checkout. Once the button is active, it accepts only develop/master migration sources; prepare the schema on preview before merging a schema-dependent feature into develop when that merge triggers deployment.
- **Production:** test migrations/feature on preview, ensure reviewed migrations are on develop, then run the master workflow with **Production + develop** before promoting application changes to master. This lets production receive the new schema before master auto-deploys dependent Functions. A successful database update does not itself publish the feature.

The first tooling promotion to master also triggers the existing Pages deployment. Apply any pending production migrations needed by that release using the npm script before that promotion; the new button cannot solve its own first-release bootstrap.

Migrations applied before a deployment must remain compatible with the currently running application. For later destructive changes, use staged schema changes (add, migrate usage, then remove) and a deliberate release plan. An application rollback does not undo SQL migrations; use a reviewed corrective migration or an explicit recovery procedure.

Fully automatic, ordered migration + Pages deployment remains a future improvement. This phase does not change deployment triggers or run remote database updates during implementation/CI.
