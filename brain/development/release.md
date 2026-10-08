# Release

Publishing is off. `.github/workflows/release.yml` runs only when the repository variable `RELEASE_ENABLED` is `true`, and setting it is the owner's decision ([[decisions/2026-10-08-release-gated-on-variable]]). Nothing in a session or pull request should set it, tag, publish or bump the version.

## The flow once enabled

On a push to `main` (or a manual dispatch), `changesets/action`:

- with pending changesets in `.changeset/`, opens or updates a "Version Packages" pull request that bumps `package.json` and writes `CHANGELOG.md`;
- with none, runs `pnpm release`, which is `scripts/release.sh`.

`scripts/release.sh` compares `package.json` `version` with what the Marketplace has for `SferaDev.vscode-extension-vercel-ai` (`vsce show`). If they match it exits; otherwise it runs `pnpm package` and `vsce publish --no-dependencies --packagePath ./*.vsix`, treating "already exists" as success because a concurrent run may have published first.

Secrets the workflow reads: `GIT_TOKEN`, so the version pull request's merge triggers the workflow again (a push by the Actions token would not), and `VSCE_PAT` for the Marketplace. The package is `private` in `package.json` and nothing goes to npm (the workflow comment). Open VSX is not published to.

`.changeset/config.json` versions private packages and does not tag them (`privatePackages.tag: false`), so a release creates no git tag.

## Current state

Read 2026-10-08: the Marketplace lists `SferaDev.vscode-extension-vercel-ai` at `0.4.1`, last updated 2026-08-09, the day SferaDev/SferaDev#597 versioned it in the monorepo. `package.json` is also `0.4.1`. The repository has no tags, and the first `Release` run on `main` was skipped because the variable is unset.

To add a release note to a change, run `pnpm changeset` and commit the file it writes.
