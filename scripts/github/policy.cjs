'use strict';

function conventionalTitle(title, body = '') {
  const match = /^(feat|fix|perf|refactor|docs|test|build|ci|chore|style|revert)(?:\([^\r\n()]+\))?(!)?: ([^\r\n]+)$/.exec(title);
  if (!match || !match[3].trim()) {
    throw new Error('Use a conventional PR title, such as "fix: preserve episode identities" or "feat!: change the policy contract".');
  }
  const breaking = Boolean(match[2]) || /^BREAKING[ -]CHANGE:/m.test(body);
  const bump = breaking ? 'major' : match[1] === 'feat' ? 'minor'
    : ['fix', 'perf', 'revert'].includes(match[1]) ? 'patch' : 'none';
  return {type: match[1], bump};
}

function needsContainers(files) {
  return files.some(path => path.startsWith('docker/') || [
    '.github/workflows/ci.yml', '.github/workflows/container-ci.yml',
    '.github/workflows/release.yml', 'scripts/github/policy.cjs',
    'nyssa_bench/container_smoke.py', 'pyproject.toml', 'uv.lock',
  ].includes(path));
}

function managedLabels(pr, files) {
  const labels = [];
  try { labels.push(`release:${conventionalTitle(pr.title, pr.body || '').bump}`); }
  catch { /* CI reports the invalid title; labels must still be reconciled. */ }
  const size = (pr.additions || 0) + (pr.deletions || 0);
  labels.push(`size:${size < 10 ? 'XS' : size < 100 ? 'S' : size < 500 ? 'M' : size < 1000 ? 'L' : 'XL'}`);
  const areas = {
    ci: path => path.startsWith('.github/') || path.startsWith('scripts/github/'),
    dependencies: path => ['pyproject.toml', 'uv.lock'].includes(path),
    docs: path => path.startsWith('docs/') || path.endsWith('.md'),
    tests: path => path.startsWith('tests/'),
    engines: path => /^nyssa_bench\/(engines|tasks)\//.test(path),
    policies: path => /^nyssa_bench\/(policies|experts|baselines)\//.test(path),
    datasets: path => path.startsWith('nyssa_bench/datasets/'),
    release: path => /release|version\.py$/.test(path),
  };
  for (const [area, matches] of Object.entries(areas)) {
    if (files.some(matches)) labels.push(`area:${area}`);
  }
  if (pr.user.login === 'dependabot[bot]') labels.push('dependencies', 'bot:dependabot');
  return labels;
}

function assertGate(results, containersRequired) {
  for (const job of ['policy', 'test', 'package', 'installed-artifact', 'automation']) {
    if (results[job]?.result !== 'success') throw new Error(`${job} did not succeed`);
  }
  const expected = containersRequired ? 'success' : 'skipped';
  if (results.containers?.result !== expected) throw new Error(`containers must be ${expected}`);
}

module.exports = {conventionalTitle, needsContainers, managedLabels, assertGate};
