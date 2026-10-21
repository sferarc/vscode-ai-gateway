# Release

`.github/workflows/release.yml` runs only when the repository variable `RELEASE_ENABLED` is `true` ([[decisions/2026-10-08-release-gated-on-variable]]). It was set to `true` on 2026-10-20 after the publish path was checked (below). Do not tag, publish or bump the version by hand; the version pull request does it. Setting or clearing the variable and merging the version pull request stay the owner's steps.

## The flow

On a push to `main` (or a manual dispatch), `changesets/action`:

- with pending changesets in `.changeset/`, opens or updates a "Version Packages" pull request that bumps `package.json` and writes `CHANGELOG.md`;
- with none, runs `pnpm release`, which is `scripts/release.sh`.

`scripts/release.sh` compares `package.json` `version` with what the Marketplace has for `SferaDev.vscode-extension-vercel-ai` (`vsce show`). If they match it exits; otherwise it runs `pnpm package` and `vsce publish --no-dependencies --packagePath ./*.vsix`, treating "already exists" as success because a concurrent run may have published first.

Secrets the workflow reads (both exist as of 2026-10-20: `GIT_TOKEN` as an organization secret, `VSCE_PAT` on the repository): `GIT_TOKEN`, so the version pull request's merge triggers the workflow again (a push by the Actions token would not), and `VSCE_PAT` for the Marketplace. The package is `private` in `package.json` and nothing goes to npm (the workflow comment). Open VSX is not published to.

`.changeset/config.json` versions private packages and does not tag them (`privatePackages.tag: false`), so versioning itself creates no tag. `release.sh` does not pass `CHANGESETS_OUTPUT`, so every publish logs "Failed to read changesets output ... GitHub releases and git tags cannot be created without this output" and the action creates no tag or release. `v0.5.0` was not made by the action; the GitHub release was published by SferaDev 33 minutes after the publish run, so it was a manual step by the owner.

The repository has `HQ_AUTOMERGE=true` and the changesets author is on HQ's author list, so HQ would land a "Version Packages" pull request, and landing it publishes. Every such pull request therefore carries `needs-human` until the owner merges it.

## Current state

0.5.0 is published: the "Version Packages" pull request (#48) merged on 2026-10-21 as `a0c487a`, `package.json` is `0.5.0`, and the git tag `v0.5.0` and a GitHub release `v0.5.0` exist. The Release run 39556789195 (push of `a0c487a`, 2026-10-21) logged "Publishing extension 0.5.0 (Marketplace has 0.4.1)" and "Published SferaDev.vscode-extension-vercel-ai v0.5.0.", and `vsce show` returns 0.5.0.

If a publish fails after a version pull request merges, `main` is ahead of the Marketplace. No changesets remain then, so `scripts/release.sh` publishes on the next push to `main` or manual dispatch once `VSCE_PAT` is fixed.

To add a release note to a change, run `pnpm changeset` and commit the file it writes.
