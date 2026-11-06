# The Version Packages pull request auto-lands

Recorded 2026-11-06 in #255. Basis: the owner's decision of 2026-10-19, when the organization moved to per-pull-request merging on `main`, that release pull requests auto-land on their required checks like any other. No issue or pull request comment carries it, so this file is the record. It supersedes [[2026-10-21-agents-merge-version-packages]], which kept the version pull request behind an independent review and a hand merge.

## Decision

The release workflow arms squash auto-merge on the "Version Packages" pull request every time `changesets/action` creates or updates it (the step "Enable auto-merge on the version PR"), using the sferarc-hq App token. The required checks on `main` (`Check`, `Approved stack` and `No Claude attribution`) are its only gate; nobody reviews or merges it by hand. Merging it publishes to the VS Code Marketplace and the workflow then tags `v<version>`.

The pull request only carries what `changeset version` wrote (`package.json` and `CHANGELOG.md`), and each changeset in it was reviewed in the pull request that added it, so a second review of the version bump checks nothing new. Agents still never publish by hand, bump the version, tag, or set `RELEASE_ENABLED`, which stays the owner's switch for turning releases off.

## Scope

The Marketplace is the only target. Nothing goes to Open VSX or npm ([[2026-10-22-backfill-release-tags]]).

## What would reopen it

A publish that ships something no changeset described, a failed publish or an expired `VSCE_PAT`, or a decision to publish to another registry. Removing the auto-merge step, or asking for a review of the version pull request again, needs a new dated decision that supersedes this one.

See [[development/release]].
