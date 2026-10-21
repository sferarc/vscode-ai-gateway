# Release

`.github/workflows/release.yml` runs only when the repository variable `RELEASE_ENABLED` is `true` ([[decisions/2026-10-08-release-gated-on-variable]]). It was set to `true` on 2026-10-20 after the publish path was checked (below). Do not tag, publish or bump the version by hand; the version pull request and the workflow do it. Setting or clearing the variable stays the owner's step; merging the version pull request is open to agents.

## The flow

On a push to `main` (or a manual dispatch), `changesets/action`:

- with pending changesets in `.changeset/`, opens or updates a "Version Packages" pull request that bumps `package.json` and writes `CHANGELOG.md`;
- with none, runs `pnpm release`, which is `scripts/release.sh`.

`scripts/release.sh` compares `package.json` `version` with what the Marketplace has for `SferaDev.vscode-extension-vercel-ai` (`vsce show`). If they match it exits; otherwise it runs `pnpm package` and `vsce publish --no-dependencies --packagePath ./*.vsix`, treating "already exists" as success because a concurrent run may have published first.

Secrets the workflow reads (both exist as of 2026-10-20: `GIT_TOKEN` as an organization secret, `VSCE_PAT` on the repository): `GIT_TOKEN`, so the version pull request's merge triggers the workflow again (a push by the Actions token would not), and `VSCE_PAT` for the Marketplace. The package is `private` in `package.json` and nothing goes to npm (the workflow comment). Open VSX is not published to.

`.changeset/config.json` versions private packages and does not tag them (`privatePackages.tag: false`), so `changesets/action` creates no tag or release. A final workflow step runs `gh release create v<package.json version> --target $GITHUB_SHA` when that release is absent, which also creates the tag, so reruns and dispatches are idempotent. Both steps use `secrets.GIT_TOKEN || github.token`; `github.token` can tag and release, but a version PR it merges would not trigger the workflow.

`CHANGELOG.md` is shipped in the VSIX (not in `.vscodeignore`) so the Marketplace shows it.

## Current state

`SferaDev.vscode-extension-vercel-ai` `0.5.0` was published by the run on Version Packages #48 (39556789195), which proves `VSCE_PAT`. The tag step runs only when `changesets/action` reports no pending changesets, so a push that opens or updates a version PR never tags. `v0.5.0` was created once by hand at `a0c487a`, the commit that shipped.

Without `GIT_TOKEN` the workflow logs a warning and uses `github.token`: the version PR is still created, but merging it does not retrigger the workflow, so dispatch it by hand to publish.

To add a release note to a change, run `pnpm changeset` and commit the file it writes.
