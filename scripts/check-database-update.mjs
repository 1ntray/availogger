import { pathToFileURL } from 'node:url';

// This checks manual workflow intent; GitHub environments control secret access.
export function validateDatabaseUpdate({ target, migrationsBranch, workflowRef }) {
  if (!['preview', 'production'].includes(target)) throw new Error('Choose Preview or Production.');
  if (!['develop', 'master'].includes(migrationsBranch)) throw new Error('Choose migrations from develop or master.');
  if (!['refs/heads/develop', 'refs/heads/master'].includes(workflowRef)) {
    throw new Error('Run the workflow from develop or master, not a feature branch or tag.');
  }
  if (target === 'production') {
    if (workflowRef !== 'refs/heads/master') throw new Error('Production updates must run the trusted master workflow.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    validateDatabaseUpdate({ target: process.env.DB_TARGET, migrationsBranch: process.env.MIGRATIONS_BRANCH,
      workflowRef: process.env.WORKFLOW_REF });
    console.log(`Database update validated: ${process.env.DB_TARGET}, migrations from ${process.env.MIGRATIONS_BRANCH}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
