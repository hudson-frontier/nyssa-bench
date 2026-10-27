'use strict';

const catalog = require('../../.github/labels.json');
const {managedLabels} = require('./policy.cjs');
const {pullFiles} = require('./ci.cjs');

async function syncCatalog(github, repo) {
  const existing = new Map((await github.paginate(github.rest.issues.listLabelsForRepo,
    {...repo, per_page: 100})).map(label => [label.name, label]));
  for (const label of catalog) {
    const old = existing.get(label.name);
    if (!old) await github.rest.issues.createLabel({...repo, ...label});
    else if (old.color !== label.color || old.description !== label.description) {
      await github.rest.issues.updateLabel({...repo, ...label});
    }
  }
}

async function reconcileLabels(github, repo, pr, files) {
  const desired = new Set(managedLabels(pr, files));
  const current = new Set(pr.labels.map(label => label.name));
  const owned = catalog.map(label => label.name).filter(name => /^(area:|size:|release:|bot:)/.test(name));
  // Retire old merge opt-ins; labels never authorize a merge.
  owned.push('automerge', 'automerge:dependencies');
  for (const name of owned) {
    if (current.has(name) && !desired.has(name)) {
      await github.rest.issues.removeLabel({...repo, issue_number: pr.number, name});
    }
  }
  const additions = [...desired].filter(name => !current.has(name));
  if (additions.length) await github.rest.issues.addLabels({...repo, issue_number: pr.number, labels: additions});
}

async function run({github, context, core}) {
  await syncCatalog(github, context.repo);
  const number = context.payload.pull_request?.number || Number(context.payload.inputs?.pr_number);
  if (number > 0) {
    const pr = (await github.rest.pulls.get({...context.repo, pull_number: number})).data;
    if (pr.state === 'open' && pr.base.ref === 'main') {
      await reconcileLabels(github, context.repo, pr, await pullFiles(github, context.repo, pr));
    }
  }
  core.info('Labels reconciled. Merges require a maintainer after all applicable checks pass.');
}

module.exports = {run, syncCatalog, reconcileLabels};
