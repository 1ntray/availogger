import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { planFromEnvironment } from './release-target.mjs';

export function validateBindings(config, plan) {
  if (config.name !== 'availogger' || config.pages_build_output_dir !== './frontend/dist') throw new Error('Expected the existing availogger Pages project and frontend/dist output.');
  const production = config.d1_databases?.find(binding => binding.binding === 'DB');
  const preview = config.env?.preview?.d1_databases?.find(binding => binding.binding === 'DB');
  if (production?.database_name !== 'studentportal-db' || preview?.database_name !== 'studentportal-preview' ||
      !production.database_id || !preview.database_id || production.database_id === preview.database_id) throw new Error('Production and preview must use their separate, correctly named D1 databases.');
  const productionKV = config.kv_namespaces?.find(binding => binding.binding === 'AVAILABILITY_CACHE');
  const previewKV = config.env?.preview?.kv_namespaces?.find(binding => binding.binding === 'AVAILABILITY_CACHE');
  if (!productionKV?.id || !previewKV?.id || productionKV.id === previewKV.id) throw new Error('Production and preview must retain separate availability KV bindings.');
  const selected = plan.target === 'preview' ? preview : production;
  if (selected.database_name !== plan.database || selected.migrations_dir !== './migrations') throw new Error('Release target does not match its D1 binding and migration directory.');
  return selected;
}

export function validateD1Database(database, plan) {
  if (database?.name !== plan.database) throw new Error('Remote D1 database identity does not match the fixed release target; migration blocked.');
}

export function validatePagesProject(project, plan) {
  if (project?.name !== 'availogger' || project.production_branch !== 'master') throw new Error('Pages project must be availogger with production branch master.');
  // Manual preview verification is allowed during bootstrap while Git integration still runs.
  if (plan.event === 'push' && project.source?.type) {
    const source = project.source.config;
    const disabled = plan.target === 'production'
      ? source?.production_deployments_enabled === false : source?.preview_deployment_setting === 'none';
    if (!disabled) throw new Error(`Disable automatic Pages Git ${plan.target} deployments before enabling automatic releases. Use a manual release for bootstrap verification.`);
  }
}

export function pendingMigrations(files, queryOutput) {
  const response = JSON.parse(queryOutput);
  if (!Array.isArray(response) || response.length !== 1 || response[0].success !== true || !Array.isArray(response[0].results) ||
      response[0].results.some(row => typeof row.name !== 'string')) throw new Error('Could not verify D1 migration history.');
  const applied = new Set(response[0].results.map(row => row.name));
  return files.filter(file => !applied.has(file));
}

export function wranglerDatabaseArgs(plan) {
  return [plan.database, '--remote', ...(plan.target === 'preview' ? ['--env', 'preview'] : []), '--config', 'wrangler.jsonc'];
}

export function migrateAndVerify(plan, run, files) {
  const targetArgs = wranglerDatabaseArgs(plan);
  run(['d1', 'migrations', 'list', ...targetArgs]);
  run(['d1', 'migrations', 'apply', ...targetArgs]);
  run(['d1', 'migrations', 'list', ...targetArgs]);
  const history = run(['d1', 'execute', ...targetArgs, '--command', 'SELECT name FROM d1_migrations ORDER BY id', '--json'], true);
  const pending = pendingMigrations(files, history);
  if (pending.length) throw new Error(`Migrations remain pending; deployment blocked: ${pending.join(', ')}`);
  console.log(`Verified: no pending ${plan.target} migrations.`);
}

export function preparePagesBundle(buildDirectory = 'frontend/dist', functionsDirectory = '.wrangler/pages-build') {
  if (!existsSync(`${buildDirectory}/index.html`) || !existsSync(`${functionsDirectory}/index.js`)) throw new Error('Build frontend and Pages Functions before preparing a release.');
  const routes = JSON.parse(readFileSync(`${buildDirectory}/_routes.json`, 'utf8'));
  if (!routes.include?.includes('/api/*')) throw new Error('Pages routing must include /api/* Functions.');
  if (existsSync(`${buildDirectory}/_worker.js`)) throw new Error('Release bundle already exists; rebuild frontend before preparing again.');
  // Generated Functions retain file routing, Access middleware and the ASSETS fallback.
  cpSync(functionsDirectory, `${buildDirectory}/_worker.js`, { recursive: true });
  console.log('Prepared frontend/dist with the already-built Pages Functions in _worker.js/index.js.');
}

function runWrangler(args, capture = false) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', env: { ...process.env, CI: 'true' },
  });
  if (result.error || result.status !== 0) throw new Error(`Wrangler ${args.slice(0, 3).join(' ')} failed; see logs above.`);
  return result.stdout;
}

async function main() {
  if (process.argv[2] === 'prepare') return preparePagesBundle();
  if (!['migrate', 'database-only'].includes(process.argv[2])) throw new Error('Choose prepare, migrate or database-only.');
  const plan = planFromEnvironment();
  if (!plan.enabled) throw new Error(`Automatic ${plan.target} release disabled; no remote commands executed. Deployment must remain blocked.`);
  if (process.argv[2] === 'database-only' && plan.event !== 'workflow_dispatch') throw new Error('Database-only updates must be manual.');
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (revision.status !== 0 || revision.stdout.trim() !== plan.sha) throw new Error('Checkout must match the exact release SHA.');
  const { config, error } = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync('wrangler.jsonc', 'utf8'));
  if (error) throw new Error('Invalid Wrangler JSONC configuration.');
  const binding = validateBindings(config, plan);
  if (!process.env.CLOUDFLARE_API_TOKEN || !/^[a-f0-9]{32}$/.test(process.env.CLOUDFLARE_ACCOUNT_ID ?? '')) throw new Error('Configure CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the selected GitHub environment.');
  const databaseResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${encodeURIComponent(binding.database_id)}`, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!databaseResponse.ok) throw new Error(`D1 identity verification failed (HTTP ${databaseResponse.status}); no migrations started.`);
  const databaseData = await databaseResponse.json();
  if (!databaseData.success) throw new Error('D1 identity verification failed; no migrations started.');
  validateD1Database(databaseData.result, plan);
  if (process.argv[2] === 'migrate') {
    if (!existsSync('frontend/dist/_worker.js/index.js')) throw new Error('Prepared Pages Functions bundle is missing; migration blocked.');
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/availogger`, {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Pages project verification failed (HTTP ${response.status}); no migrations started.`);
    const data = await response.json();
    if (!data.success) throw new Error('Pages project verification failed; no migrations started.');
    validatePagesProject(data.result, plan);
  }
  const files = readdirSync('migrations').filter(file => file.endsWith('.sql')).sort();
  for (const file of files) if (readFileSync(`migrations/${file}`, 'utf8').includes('\r')) throw new Error(`Migration ${file} must use LF line endings.`);
  migrateAndVerify(plan, runWrangler, files);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
