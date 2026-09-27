import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const targets = {
  'refs/heads/develop': { branch: 'develop', target: 'preview', environment: 'database-preview', database: 'studentportal-preview', variable: 'AUTO_RELEASE_PREVIEW' },
  'refs/heads/master': { branch: 'master', target: 'production', environment: 'database-production', database: 'studentportal-db', variable: 'AUTO_RELEASE_PRODUCTION' },
};

export function releasePlan({ ref, sha, event, previewEnabled, productionEnabled }) {
  if (!Object.hasOwn(targets, ref)) throw new Error('Only develop and master branch refs may release; feature branches, tags and PR refs are rejected.');
  if (!['push', 'workflow_dispatch'].includes(event)) throw new Error('Only push or workflow_dispatch may release.');
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('An exact 40-character commit SHA is required.');
  const target = targets[ref];
  const setting = target.target === 'preview' ? previewEnabled : productionEnabled;
  return { ...target, sha, event, enabled: event === 'workflow_dispatch' || setting === 'true' };
}

export function planFromEnvironment(env = process.env) {
  return releasePlan({ ref: env.GITHUB_REF, sha: env.GITHUB_SHA, event: env.GITHUB_EVENT_NAME,
    previewEnabled: env.AUTO_RELEASE_PREVIEW, productionEnabled: env.AUTO_RELEASE_PRODUCTION });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const plan = planFromEnvironment();
    if (process.env.GITHUB_OUTPUT) for (const [key, value] of Object.entries(plan)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    const message = plan.enabled ? `${plan.target} release selected: ${plan.branch} at ${plan.sha}.`
      : `Automatic ${plan.target} release disabled: set repository variable ${plan.variable}=true after setup. No remote migration or deployment will run.`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
