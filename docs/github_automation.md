# GitHub automation

Pull requests use conventional titles, automatic labels, and manual squash
merges. Maintainers merge only after all applicable checks pass on the current
head, the branch is up to date, and review conversations are resolved.

## Pull requests and dependency updates

Use a title such as `fix: preserve episode identities`, `feat: add an adapter`,
or `feat!: remove an old contract`. The PR title becomes the squash commit title
and determines the version bump when a maintainer prepares a release.

The PR bot maintains `area:*`, `size:*`, `release:*`, and Dependabot labels.
It removes outdated generated labels and retired `automerge` opt-ins. Its token
can read repository content and update issue labels; it cannot merge PRs or
dispatch publication. No label authorizes an automatic merge.

Dependabot checks GitHub Actions and `uv` dependencies weekly. Patch/minor
updates are grouped; major updates remain separate. Every update needs manual
review and successful CI. The validated `torch`, `torchvision`, and `mani-skill`
pins require evaluation together on compatible simulator infrastructure.

## CI and merging

The core checks are `test`, `package`, `installed-artifact (3.10)`,
`installed-artifact (3.13)`, and `CI gate`, supplied by GitHub Actions.
The gate also requires conventional-title/path checks, automation tests, and
Actionlint. Container-related changes require all three container smoke profiles.
A skipped, failed, or cancelled required job cannot make the gate green.
Optional self-hosted GPU checks do not establish simulator evidence when skipped.

Before merging, inspect all current checks and external statuses, update stale
branches, and resolve review conversations. Use a squash merge with the exact
checked head SHA. Enable strict branch protection or rulesets to enforce these
requirements on the server; the workflows do not configure repository settings.

Privileged label automation checks out only `main`; it never executes PR code
or downloads PR artifacts. Titles and bodies go to GitHub APIs, not shell
commands. Normal CI has read-only access.

## Manual version preparation

Release PR generation is disabled: CI completion and conventional commit titles
never start a version bump, create a tag, or publish a release. Prepare a version
PR manually by updating `nyssa_bench/version.py` and `CHANGELOG.md` together.
The version module is the only version source; Hatch and the CLI both read it.
The unpublished candidate remains `0.0.1rc1`, and the first planned stable release
is `0.0.1`. NEP remains independently versioned at `0.1.0`.

A maintainer reviews and manually squash merges a version PR only after every
applicable check passes. Merging it does not start publication.

## Manual publication and recovery

Create a release tag on the qualified main commit, then explicitly run
**Release Python package** at that tag. Tag pushes do not start publication.
The workflow requires the latest main CI run for the exact tagged commit to
have succeeded. It retains the existing PyPI/TestPyPI environment approvals,
provenance, installed-wheel checks, and refusal to overwrite immutable images.
See [Releasing](releasing.md) for candidate qualification and publishing commands.

Keep repository auto-merge disabled and squash merging enabled. Default workflow
permissions can remain read-only. Review and publication protections must remain
in place.

Use **PR automation → Run workflow** with a PR number to reconcile labels, or
`0` to synchronize the label catalog. It never retries a merge. When recovering
from failed automation, disable release workflows until the repair is merged
and main CI is green. Do not rerun publication to repair an unrelated CI failure.

Local validation:

```bash
node --test scripts/github/*.test.cjs
actionlint
uv run pre-commit run --all-files
uv run pre-commit run --hook-stage pre-push --all-files
```

References: [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
[Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).
