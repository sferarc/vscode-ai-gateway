# Release

`.github/workflows/release.yml` runs only when the repository variable `RELEASE_ENABLED` is `true` ([[decisions/2026-10-08-release-gated-on-variable]]). It was set to `true` on 2026-10-20 after the publish path was checked (below). Do not tag, publish or bump the version by hand; the version pull request does it. Setting or clearing the variable and merging the version pull request stay the owner's steps.

## The flow

On a push to `main` (or a manual dispatch), `changesets/action`:

- with pending changesets in `.changeset/`, opens or updates a "Version Packages" pull request that bumps `package.json` and writes `CHANGELOG.md`;
- with none, runs `pnpm release`, which is `scripts/release.sh`.

`scripts/release.sh` compares `package.json` `version` with what the Marketplace has for `SferaDev.vscode-extension-vercel-ai` (`vsce show`). If they match it exits; otherwise it runs `pnpm package` and `vsce publish --no-dependencies --packagePath ./*.vsix`, treating "already exists" as success because a concurrent run may have published first.

Secrets the workflow reads (both exist as of 2026-10-20: `GIT_TOKEN` as an organization secret, `VSCE_PAT` on the repository): `GIT_TOKEN`, so the version pull request's merge triggers the workflow again (a push by the Actions token would not), and `VSCE_PAT` for the Marketplace. The package is `private` in `package.json` and nothing goes to npm (the workflow comment). Open VSX is not published to.

`.changeset/config.json` versions private packages and does not tag them (`privatePackages.tag: false`), so a release creates no git tag.

## Current state

Read 2026-10-20: the Marketplace lists `SferaDev.vscode-extension-vercel-ai` at `0.4.1`; `package.json` is `0.4.1`. The repository has no tags. `pnpm package` produces a valid VSIX at `0.4.1` (11 files). A manual `Release` dispatch on `main` after `RELEASE_ENABLED` was set opened the "Version Packages" pull request (#48), which bumps `0.4.1` to `0.5.0` and writes `CHANGELOG.md`.

Whether `VSCE_PAT` is valid and carries the Marketplace `Manage` scope is unknown: a secret cannot be read back, and the first publish is the first real use. Merging the version pull request publishes, so merge it only after the token is confirmed. The repository has `HQ_AUTOMERGE=true` and the pull request author is in HQ's author list, so only the `needs-human` label on #48 keeps HQ from landing it. The owner removes the label once the token is confirmed.

If the token turns out to be bad, the publish fails after the merge: `main` stays at `0.5.0` while the Marketplace shows `0.4.1`. No changesets remain, so `scripts/release.sh` publishes on the next push to `main` or manual dispatch once `VSCE_PAT` is fixed.

To add a release note to a change, run `pnpm changeset` and commit the file it writes.
