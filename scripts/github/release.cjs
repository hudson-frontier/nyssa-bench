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

async function verifyMain({github, context, core}) {
  if (context.eventName !== 'workflow_dispatch' || context.ref !== 'refs/heads/main') {
    throw new Error('Release preparation requires a manual workflow dispatch on main.');
  }
  const branch = (await github.rest.repos.getBranch({...context.repo, branch: 'main'})).data;
  await requireSuccessfulCI(github, context.repo, branch.commit.sha);
  core.setOutput('ready', 'true');
}

async function verifyPublication({github, context}) {
  if (context.eventName !== 'workflow_dispatch'
      || !/^refs\/tags\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:rc\d+)?$/.test(context.ref)) {
    throw new Error('Publication requires a manual workflow dispatch at a release tag.');
  }
  await requireSuccessfulCI(github, context.repo, context.sha);
}

async function dispatch({github, context, core}) {
  const prs = JSON.parse(process.env.RELEASE_PRS || '[]');
  for (const item of prs) {
    const pr = (await github.rest.pulls.get({...context.repo, pull_number: item.number})).data;
    if (pr.state !== 'open' || pr.base.ref !== 'main'
        || pr.head.repo.full_name !== `${context.repo.owner}/${context.repo.repo}`
        || !pr.head.ref.startsWith('release-please--')) {
      throw new Error('Refusing to dispatch CI for an unexpected release PR.');
    }
    await github.rest.actions.createWorkflowDispatch({
      ...context.repo, workflow_id: 'ci.yml', ref: pr.head.ref,
    });
    await github.rest.actions.createWorkflowDispatch({
      ...context.repo, workflow_id: 'pr-automation.yml', ref: 'main',
      inputs: {pr_number: String(pr.number)},
    });
    core.info(`Dispatched CI and labels for release PR #${pr.number}; merge and publication remain manual.`);
  }
}

module.exports = {verifyMain, verifyPublication, dispatch};
