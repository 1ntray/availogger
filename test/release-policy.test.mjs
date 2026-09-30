import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { releasePlan } from '../scripts/release-target.mjs';
import { migrateAndVerify, pendingMigrations, preparePagesBundle, validateBindings, validateD1Database, validatePagesProject, wranglerDatabaseArgs } from '../scripts/release-tools.mjs';

const sha = 'a'.repeat(40);
const input = { ref: 'refs/heads/develop', sha, event: 'push', previewEnabled: 'true' };
const preview = releasePlan(input);
const production = releasePlan({ ...input, ref: 'refs/heads/master', productionEnabled: 'true' });
const config = () => ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')).config;
const history = names => JSON.stringify([{ success: true, results: names.map(name => ({ name })) }]);

describe('release selection and bootstrap controls', () => {
  it('maps develop only to preview and master only to production', () => {
    expect(preview).toMatchObject({ branch: 'develop', target: 'preview', database: 'studentportal-preview', environment: 'database-preview', sha, enabled: true });
    expect(production).toMatchObject({ branch: 'master', target: 'production', database: 'studentportal-db', environment: 'database-production', sha, enabled: true });
    expect(wranglerDatabaseArgs(preview)).toEqual(['studentportal-preview', '--remote', '--env', 'preview', '--config', 'wrangler.jsonc']);
    expect(wranglerDatabaseArgs(production)).toEqual(['studentportal-db', '--remote', '--config', 'wrangler.jsonc']);
  });
  it('deploys the redesign branch as its own preview alias on the preview database', () => {
    const redesign = releasePlan({ ...input, ref: 'refs/heads/redesign' });
    expect(redesign).toMatchObject({ branch: 'redesign', target: 'preview', database: 'studentportal-preview', environment: 'database-preview', enabled: true });
    expect(wranglerDatabaseArgs(redesign)).toEqual(wranglerDatabaseArgs(preview));
    expect(releasePlan({ ...input, ref: 'refs/heads/redesign', previewEnabled: 'false' }).enabled).toBe(false);
  });
  it.each(['refs/heads/feature/test', 'refs/heads/redesign/child', 'refs/pull/1/merge', 'refs/tags/redesign', 'develop', ''])('rejects untrusted ref %s', ref => {
    expect(() => releasePlan({ ...input, ref, event: 'workflow_dispatch' })).toThrow('branch refs');
  });
  it.each(['pull_request', 'pull_request_target', 'workflow_run'])('rejects event %s', event => {
    expect(() => releasePlan({ ...input, event })).toThrow('push or workflow_dispatch');
  });
  it.each([undefined, '', 'HEAD', 'main', 'a'.repeat(39)])('requires an exact immutable SHA: %s', badSHA => {
    expect(() => releasePlan({ ...input, sha: badSHA })).toThrow('commit SHA');
  });
  it.each([undefined, '', 'false', 'TRUE', '1'])('disables automatic releases for missing/non-true setting %s', setting => {
    expect(releasePlan({ ...input, previewEnabled: setting }).enabled).toBe(false);
    expect(releasePlan({ ...input, ref: 'refs/heads/master', productionEnabled: setting }).enabled).toBe(false);
  });
  it('keeps enable controls independent', () => {
    expect(releasePlan({ ...input, previewEnabled: undefined, productionEnabled: 'true' }).enabled).toBe(false);
    expect(releasePlan({ ...input, ref: 'refs/heads/master', productionEnabled: undefined }).enabled).toBe(false);
  });
  it('allows explicit manual recovery on a trusted branch while automation is disabled', () => {
    for (const ref of ['refs/heads/develop', 'refs/heads/master']) expect(releasePlan({ ...input, ref, event: 'workflow_dispatch', previewEnabled: undefined }).enabled).toBe(true);
  });
  it('disabled migration entry point exits before credentials, remote commands or deployment', () => {
    const result = spawnSync(process.execPath, ['scripts/release-tools.mjs', 'migrate'], { encoding: 'utf8', env: {
      ...process.env, GITHUB_REF: input.ref, GITHUB_SHA: sha, GITHUB_EVENT_NAME: 'push', AUTO_RELEASE_PREVIEW: '',
      CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '',
    } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no remote commands executed');
    expect(result.stdout).not.toContain('Wrangler');
  });
});

describe('environment isolation', () => {
  it('validates both current D1/KV configurations', () => {
    for (const plan of [preview, production]) expect(() => validateBindings(config(), plan)).not.toThrow();
  });
  it.each([preview, production])('rejects a mismatched database for $target', plan => {
    expect(() => validateBindings(config(), { ...plan, database: plan === preview ? 'studentportal-db' : 'studentportal-preview' })).toThrow('target does not match');
    expect(() => validateD1Database({ name: plan === preview ? 'studentportal-db' : 'studentportal-preview' }, plan)).toThrow('migration blocked');
    expect(() => validateD1Database({ name: plan.database }, plan)).not.toThrow();
  });
  it('rejects missing, swapped or shared D1 and KV bindings', () => {
    for (const change of [
      c => { c.env.preview.d1_databases[0].database_name = 'studentportal-db'; },
      c => { c.d1_databases[0].database_name = 'studentportal-preview'; },
      c => { c.env.preview.d1_databases[0].database_id = c.d1_databases[0].database_id; },
      c => { c.env.preview.kv_namespaces[0].id = c.kv_namespaces[0].id; },
      c => { delete c.env.preview; },
    ]) { const c = config(); change(c); expect(() => validateBindings(c, preview)).toThrow(); }
  });
  it('rejects a wrong Pages project/production branch before migrating', () => {
    for (const project of [{ name: 'another-project', production_branch: 'master' }, { name: 'availogger', production_branch: 'develop' }]) {
      expect(() => validatePagesProject(project, preview)).toThrow('production branch master');
    }
  });
  it('requires independent Git deployments to be off for automatic releases but permits bootstrap manual verification', () => {
    const project = { name: 'availogger', production_branch: 'master', source: { type: 'github', config: { production_deployments_enabled: true, preview_deployment_setting: 'all' } } };
    for (const plan of [preview, production]) {
      expect(() => validatePagesProject(project, plan)).toThrow('Disable automatic Pages Git');
      expect(() => validatePagesProject(project, { ...plan, event: 'workflow_dispatch' })).not.toThrow();
    }
    project.source.config = { production_deployments_enabled: false, preview_deployment_setting: 'none' };
    for (const plan of [preview, production]) expect(() => validatePagesProject(project, plan)).not.toThrow();
  });
});

describe('migration failure gates', () => {
  it('lists, applies, lists and checks history in order using a fixed database', () => {
    const run = vi.fn((args, capture) => capture ? history(['0001.sql', '0002.sql']) : undefined);
    migrateAndVerify(preview, run, ['0001.sql', '0002.sql']);
    expect(run.mock.calls.map(([args]) => args.slice(0, 3))).toEqual([
      ['d1', 'migrations', 'list'], ['d1', 'migrations', 'apply'], ['d1', 'migrations', 'list'], ['d1', 'execute', 'studentportal-preview'],
    ]);
    expect(run.mock.calls.every(([args]) => args.includes('studentportal-preview') && !args.includes('studentportal-db'))).toBe(true);
  });
  it('stops on failed migration and does not continue to verification', () => {
    const run = vi.fn(args => { if (args[2] === 'apply') throw new Error('0005_transport.sql incomplete input'); });
    expect(() => migrateAndVerify(preview, run, ['0005_transport.sql'])).toThrow('0005_transport.sql');
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('fails closed if pending migrations remain or verification is malformed', () => {
    expect(pendingMigrations(['0001.sql', '0002.sql'], history(['0001.sql']))).toEqual(['0002.sql']);
    const run = vi.fn((args, capture) => capture ? history([]) : undefined);
    expect(() => migrateAndVerify(production, run, ['0001.sql'])).toThrow('deployment blocked');
    for (const response of ['{}', '[]', 'not json', JSON.stringify([{ success: false, results: [] }])]) {
      expect(() => pendingMigrations(['0001.sql'], response)).toThrow();
    }
  });
  it('permits repeat releases with all migrations already applied', () => {
    const run = vi.fn((args, capture) => capture ? history(['0001.sql']) : undefined);
    expect(() => migrateAndVerify(production, run, ['0001.sql'])).not.toThrow();
  });
});

describe('prebuilt Functions and workflow gates', () => {
  it('packages the tested Functions and relative modules with API routes, rather than static-only output', () => {
    const root = mkdtempSync(join(tmpdir(), 'portal-release-'));
    try {
      const assets = join(root, 'dist'), functions = join(root, 'functions');
      mkdirSync(assets); mkdirSync(functions);
      writeFileSync(join(assets, 'index.html'), '<h1>Portal</h1>');
      writeFileSync(join(assets, '_routes.json'), JSON.stringify({ include: ['/api/*'] }));
      writeFileSync(join(functions, 'index.js'), 'export { default } from "./module.js";');
      writeFileSync(join(functions, 'module.js'), 'export default { fetch() {} };');
      preparePagesBundle(assets, functions);
      expect(readFileSync(join(assets, '_worker.js/index.js'), 'utf8')).toContain('./module.js');
      expect(readFileSync(join(assets, '_worker.js/module.js'), 'utf8')).toContain('fetch');
      expect(() => preparePagesBundle(assets, functions)).toThrow('already exists');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('release YAML keeps validation/build/migration/deployment ordered and no failure override', () => {
    const yaml = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
    const stages = ['npm run check', 'npm test', 'npm --prefix frontend test', 'npm run build', 'npm run functions:build', 'release-tools.mjs prepare', 'release-tools.mjs migrate', 'pages deploy frontend/dist'];
    expect(stages.map(stage => yaml.indexOf(stage))).toEqual([...stages.map(stage => yaml.indexOf(stage))].sort((a, b) => a - b));
    for (const stage of stages) expect(yaml).toContain(stage);
    expect(yaml).not.toMatch(/continue-on-error|pull_request|--env preview.*deploy/);
    expect(yaml).toContain('if: needs.plan.outputs.enabled == \'true\'');
    expect(yaml).toContain('--commit-hash ${{ github.sha }}');
    expect(yaml).toContain('--no-bundle');
    expect(yaml.match(/ref: \$\{\{ github.sha \}\}/g)).toHaveLength(2);
    const fallback = readFileSync(new URL('../.github/workflows/update-database.yml', import.meta.url), 'utf8');
    for (const workflow of [yaml, fallback]) {
      expect(workflow).toContain('group: studentportal-release-${{ github.ref }}');
      expect(workflow).toContain('cancel-in-progress: false');
    }
    expect(fallback).not.toMatch(/migrations_branch|inputs:|pages deploy/);
  });
});
