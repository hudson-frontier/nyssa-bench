'use strict';

async function requireSuccessfulCI(github, repo, sha) {
  const runs = (await github.rest.actions.listWorkflowRuns({
    ...repo, workflow_id: 'ci.yml', branch: 'main', head_sha: sha, per_page: 100,
  })).data.workflow_runs.filter(run => run.head_sha === sha
    && ['push', 'workflow_dispatch'].includes(run.event));
  // GitHub returns newest runs first. An older success cannot override a
  // newer pending, failed, or cancelled run for the same commit.
  if (runs[0]?.status !== 'completed' || runs[0]?.conclusion !== 'success') {
    throw new Error('The release commit must pass CI in its latest main run.');
  }
}

async function verifyPublication({github, context}) {
  if (context.eventName !== 'workflow_dispatch'
      || !/^refs\/tags\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:rc\d+)?$/.test(context.ref)) {
    throw new Error('Publication requires a manual workflow dispatch at a release tag.');
  }
  await requireSuccessfulCI(github, context.repo, context.sha);
}

module.exports = {verifyPublication};
