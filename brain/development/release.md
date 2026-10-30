# Release

`.github/workflows/release.yml` runs only when the repository variable `RELEASE_ENABLED` is `true` ([[decisions/2026-10-08-release-gated-on-variable]]). It was set to `true` on 2026-10-20 after the publish path was checked (below). Do not tag, publish or bump the version by hand; the version pull request and the workflow do it. Setting or clearing the variable stays the owner's step. Agents may merge the version pull request under the normal bar ([[decisions/2026-10-21-agents-merge-version-packages]]).

## The flow

On a push to `main` (or a manual dispatch), `changesets/action`:

- with pending changesets in `.changeset/`, opens or updates a "Version Packages" pull request that bumps `package.json` and writes `CHANGELOG.md`;
- with none, runs `pnpm release`, which is `scripts/release.sh`.

`scripts/release.sh` compares `package.json` `version` with what the Marketplace has for `SferaDev.vscode-extension-vercel-ai` (`vsce show`). If they match it exits; otherwise it runs `pnpm package` and `vsce publish --no-dependencies --packagePath ./*.vsix`, treating "already exists" as success because a concurrent run may have published first.

Secrets the workflow reads (both exist as of 2026-10-20: `GIT_TOKEN` as an organization secret, `VSCE_PAT` on the repository): `GIT_TOKEN`, so the version pull request and its branch push trigger `pull_request` workflows such as the required `Check` (those made by the Actions token trigger none), and `VSCE_PAT` for the Marketplace. The package is `private` in `package.json` and nothing goes to npm (the workflow comment). Open VSX is not published to.

`.changeset/config.json` versions private packages and does not tag them (`privatePackages.tag: false`), so `changesets/action` creates no tag or release. A final workflow step runs `gh release create v<package.json version> --target $GITHUB_SHA` when that release is absent, which also creates the tag, so reruns and dispatches are idempotent. Both steps use `secrets.GIT_TOKEN || github.token`; `github.token` can tag and release, but the version PR it opens never gets the required `Check`. The tag step is limited to `main` and gated on the action's `has-changesets` output, which is kebab-case (`index.ts` in `changesets/action` v2.1.2 sets `has-changesets`); `hasChangesets` is not an output, evaluates empty and skips the step on every run. If publishing succeeds and the tag step fails, the next push tags a later commit than the one that shipped.

`CHANGELOG.md` is shipped in the VSIX (not in `.vscodeignore`) so the Marketplace shows it.

## Current state

`SferaDev.vscode-extension-vercel-ai` `0.5.0` was published by the run on Version Packages #48 (39556789195), which proves `VSCE_PAT`. The version pull request goes through the same gate as any other: required checks green and an independent review clean. The tag step runs only when `changesets/action` reports no pending changesets, so a push that opens or updates a version PR never tags. `v0.5.0` was created once by hand at `a0c487a`, the commit that shipped. `0.5.1` (Version Packages #56) and `0.5.2` (#59, `c722a91`) were published without a tag or release because the step read `hasChangesets`, so it was skipped (runs 39636897330 and 39688604271); `src/release-workflow.test.ts` guards the spelling. Since the fix (#60) merged, a push to `main` with no pending changesets tags and releases the `package.json` version at that commit, so it would not tag `v0.5.1` or `v0.5.2`. Both were backfilled by hand on 2026-10-22: `v0.5.1` at `12053e9` and `v0.5.2` at `c722a91`, each with a release ([[decisions/2026-10-22-backfill-release-tags]]). The patch changeset `.changeset/tag-release-after-publish.md` keeps `has-changesets` true on the fix's own merge push, so nothing is tagged at that commit, which never shipped; the first tag the workflow created is `v0.5.3`, at the Version Packages merge commit 49d3afd (#62), and that release is the one marked Latest because the backfilled releases were not. Without it `scripts/release.sh` would skip as already published and the step would tag `v0.5.2` at the wrong commit, so keep it.

Seven more Version Packages pull requests merged between 2026-10-27 and 2026-10-28, from #78 (`0.5.4`, `40e1239`) to #103 (`0.5.10`, `d221cdb`), each carrying the patch changesets merged before it (`CHANGELOG.md`). Whether each version reached the Marketplace and got its tag was not checked for this note.

Without `GIT_TOKEN` the workflow logs a warning and uses `github.token`: the version PR is still created, but the required `Check` never runs on it, so trigger CI by hand before it can merge.

To add a release note to a change, run `pnpm changeset` and commit the file it writes.
