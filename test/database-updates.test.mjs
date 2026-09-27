import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { validateDatabaseUpdate } from '../scripts/check-database-update.mjs';

const preview = { target: 'preview', migrationsBranch: 'develop', workflowRef: 'refs/heads/develop' };
const production = { ...preview, target: 'production', workflowRef: 'refs/heads/master' };

describe('manual database update policy', () => {
  it.each(['develop', 'master'])('permits reviewed %s migrations for preview and production', branch => {
    expect(() => validateDatabaseUpdate({ ...preview, migrationsBranch: branch })).not.toThrow();
    expect(() => validateDatabaseUpdate({ ...production, migrationsBranch: branch })).not.toThrow();
  });
  it('permits preview runs from master', () => {
    expect(() => validateDatabaseUpdate({ ...preview, workflowRef: 'refs/heads/master' })).not.toThrow();
  });
  it('rejects production runs using the develop workflow', () => {
    expect(() => validateDatabaseUpdate({ ...production, workflowRef: 'refs/heads/develop' })).toThrow('trusted master');
  });
  it.each(['refs/heads/codex/database-migrations', 'refs/tags/release', 'refs/pull/15/merge'])('rejects untrusted workflow ref %s', workflowRef => {
    expect(() => validateDatabaseUpdate({ ...preview, workflowRef })).toThrow('feature branch or tag');
  });
  it.each(['feature/duty-ops-swaps', 'develop; touch /tmp/test', ''])('rejects arbitrary migration source %s', migrationsBranch => {
    expect(() => validateDatabaseUpdate({ ...production, migrationsBranch })).toThrow('develop or master');
  });
  it('fails closed for a missing or unknown database target', () => {
    for (const target of [undefined, '', 'DB', 'prod']) expect(() => validateDatabaseUpdate({ ...preview, target })).toThrow('Preview or Production');
  });
  it('exits unsuccessfully before a production update from an untrusted workflow branch', () => {
    const result = spawnSync(process.execPath, ['scripts/check-database-update.mjs'], { encoding: 'utf8', env: { ...process.env,
      DB_TARGET: 'production', MIGRATIONS_BRANCH: 'develop', WORKFLOW_REF: 'refs/heads/develop' } });
    expect(result.status).toBe(1); expect(result.stderr).toContain('trusted master');
  });
  it('executes a valid preview check without credentials or database access', () => {
    const result = spawnSync(process.execPath, ['scripts/check-database-update.mjs'], { encoding: 'utf8', env: { ...process.env,
      DB_TARGET: 'preview', MIGRATIONS_BRANCH: 'develop', WORKFLOW_REF: 'refs/heads/master' } });
    expect(result.status).toBe(0); expect(result.stdout).toContain('preview, migrations from develop');
  });
});
