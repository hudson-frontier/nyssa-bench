'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('./policy.cjs');
const {run, reconcileLabels} = require('./pr.cjs');
const {verifyPublication} = require('./release.cjs');
const {ciPolicy} = require('./ci.cjs');

const pull = () => ({number: 7, state: 'open', draft: false, title: 'fix: repair export', body: '',
  user: {login: 'contributor'}, base: {ref: 'main'}, head: {sha: 'abc'},
  labels: [{name: 'automerge'}], additions: 10, deletions: 2});
const core = () => ({info() {}, setOutput() {}});

test('conventional titles select the declared version bump', () => {
  for (const [title, bump] of [['fix: repair a bug', 'patch'], ['perf(io): read once', 'patch'],
    ['feat: support a new adapter', 'minor'], ['refactor!: remove an API', 'major'],
    ['chore(deps): bump actions', 'none'], ['docs: clarify exports', 'none']]) {
    assert.equal(policy.conventionalTitle(title).bump, bump);
  }
  assert.equal(policy.conventionalTitle('fix: remove old API', 'BREAKING CHANGE: removed').bump, 'major');
  for (const title of ['Improve things', 'fix: ', 'fix: ok\nfeat!: injected', 'fix(scope\n): bad']) {
    assert.throws(() => policy.conventionalTitle(title));
  }
});

test('container changes cannot bypass the aggregate gate', () => {
  for (const path of ['docker/Dockerfile', 'pyproject.toml', 'uv.lock',
    '.github/workflows/ci.yml', '.github/workflows/release.yml', 'scripts/github/policy.cjs']) {
    assert.equal(policy.needsContainers([path]), true);
  }
  assert.equal(policy.needsContainers(['docs/metrics.md']), false);
  const results = Object.fromEntries(['policy', 'test', 'package', 'installed-artifact', 'automation', 'containers']
    .map(name => [name, {result: 'success'}]));
  assert.doesNotThrow(() => policy.assertGate(results, true));
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(() => policy.assertGate({...results, test: {result}}, true));
  }
  assert.throws(() => policy.assertGate({...results, containers: {result: 'skipped'}}, true));
  assert.doesNotThrow(() => policy.assertGate({...results, containers: {result: 'skipped'}}, false));
});

test('label automation never merges even with old opt-ins and passing CI', async () => {
  for (const login of ['dependabot[bot]', 'github-actions[bot]', 'contributor']) {
    const pr = {...pull(), user: {login}, changed_files: 1};
    const calls = [];
    const github = {
      paginate: async method => method === github.rest.issues.listLabelsForRepo
        ? require('../../.github/labels.json') : [{filename: 'uv.lock'}],
      rest: {
        pulls: {get: async () => ({data: pr}), listFiles() {},
          merge: async () => assert.fail('Label automation attempted a merge')},
        actions: {createWorkflowDispatch: async () => assert.fail('Label automation dispatched a workflow')},
        issues: {listLabelsForRepo() {}, removeLabel: async args => calls.push(args.name), addLabels: async () => {}},
      },
    };
    pr.labels.push({name: 'automerge:dependencies'});
    await run({github, context: {repo: {}, payload: {pull_request: pr}}, core: core()});
    assert.deepEqual(calls, ['automerge', 'automerge:dependencies']);
  }
});

test('label reconciliation removes stale generated labels but keeps human controls', async () => {
  const calls = [];
  const pr = {...pull(), labels: [{name: 'release:major'}, {name: 'size:XL'}, {name: 'hold'}]};
  const github = {rest: {issues: {
    removeLabel: async args => calls.push(['remove', args.name]),
    addLabels: async args => calls.push(['add', args.labels]),
  }}};
  await reconcileLabels(github, {}, pr, ['nyssa_bench/datasets/export_json.py'], null);
  assert.ok(calls.some(([action, name]) => action === 'remove' && name === 'release:major'));
  assert.ok(!calls.some(([action, name]) => action === 'remove' && name === 'hold'));
  assert.ok(calls.find(([action]) => action === 'add')[1].includes('area:datasets'));
});

test('CI policy recognizes dispatched bot PRs and renamed container inputs', async () => {
  const outputs = {};
  const pr = {...pull(), changed_files: 1};
  let page = 0;
  const github = {paginate: async () => ++page === 1 ? [pr]
    : [{filename: 'archive/Dockerfile', previous_filename: 'docker/Dockerfile'}],
  rest: {pulls: {list() {}, listFiles() {}, get: async () => ({data: pr})}}};
  await ciPolicy({github, context: {repo: {owner: 'owner', repo: 'repo'}, payload: {},
    ref: 'refs/heads/release-please--branches--main', sha: 'abc'},
  core: {info() {}, setOutput: (name, value) => { outputs[name] = value; }}});
  assert.equal(outputs.containers, 'true');
});

function releaseArgs(runs = []) {
  return {core: core(), context: {repo: {}, payload: {}, eventName: 'workflow_dispatch',
    ref: 'refs/heads/main', sha: 'new'}, github: {rest: {
    repos: {getBranch: async () => ({data: {commit: {sha: 'new'}}})},
    actions: {listWorkflowRuns: async input => {
      assert.equal(input.head_sha, 'new');
      assert.equal(input.branch, 'main');
      assert.equal(input.status, undefined);
      return {data: {workflow_runs: runs}};
    }},
  }}};
}

const successfulRun = {head_sha: 'new', event: 'push', status: 'completed', conclusion: 'success'};

test('release checks reject stale, missing, pending, and superseded successful CI', async () => {
  for (const runs of [[], [{...successfulRun, head_sha: 'old'}],
    [{...successfulRun, event: 'pull_request'}],
    [{...successfulRun, status: 'in_progress', conclusion: null}, successfulRun],
    [{...successfulRun, conclusion: 'failure'}, successfulRun],
    [{...successfulRun, conclusion: 'cancelled'}, successfulRun]]) {
    const args = releaseArgs(runs);
    args.context.ref = 'refs/tags/v0.0.1';
    await assert.rejects(verifyPublication(args), /must pass CI/);
  }
});

test('publication requires a manual tag dispatch and successful CI for its exact commit', async () => {
  const args = releaseArgs([successfulRun]);
  for (const ref of ['refs/heads/main', 'refs/tags/v0.0.1', 'refs/tags/v0.0.1rc1']) {
    args.context.ref = ref;
    if (ref.startsWith('refs/tags/')) await assert.doesNotReject(verifyPublication(args));
    else await assert.rejects(verifyPublication(args), /manual workflow dispatch/);
  }
  args.context.eventName = 'push';
  await assert.rejects(verifyPublication(args), /manual workflow dispatch/);
  const unchecked = releaseArgs([]);
  unchecked.context.ref = 'refs/tags/v0.0.1';
  await assert.rejects(verifyPublication(unchecked), /must pass CI/);
});
