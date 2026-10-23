# Backfill the v0.5.1 and v0.5.2 tags by hand

Recorded 2026-10-22. Basis: the owner's roadmap decision of the same day, given to the agents running the maintenance round; no issue or pull request comment carries it, so this file is the record.

## Decision

The owner approved creating the missing tags and GitHub releases once, by hand: `v0.5.1` at `12053e9` (Version Packages #56) and `v0.5.2` at `c722a91` (#59). Both were published to the Marketplace without a tag because the tag step read `hasChangesets` instead of `has-changesets`. Release notes are the `CHANGELOG.md` sections. This is a one-off exception to "never tag by hand" in `CLAUDE.md`; every later tag comes from the workflow.

Done on 2026-10-22: both tags and releases exist, recorded in #66 and `brain/development/release.md`. The exception is spent.

Open VSX is a no: nothing is published there.

## What would reopen it

A tag that points at the wrong commit, or a release workflow that starts triggering on tag pushes (it triggers on branch pushes and manual dispatch only).

See [[development/release]].
