# Agents merge the Version Packages pull request

Recorded 2026-10-21 in #51. Basis: the owner's standing delegation of merges in this organization (2026-10-19) under green required checks and a clean independent review. No comment on #51 records the owner deciding this case separately; the earlier hold (86a41ac, 6597887) was lifted by 67baba6 without a stated reason.

## Decision

Agents may merge the "Version Packages" pull request under the same bar as any other: required checks green and an independent review clean. Merging it publishes to the VS Code Marketplace and the workflow then tags `v<version>`.

The first publish (`0.5.0`, run 39556789195 on #48) proved `VSCE_PAT`, so the earlier hold on that pull request no longer applies. Agents still never publish by hand, bump the version, or set `RELEASE_ENABLED`.

## Scope

The Marketplace is the only target. Nothing goes to Open VSX or npm. Open VSX is a no ([[2026-10-22-backfill-release-tags]]).

## What would reopen it

A failed publish, an expired `VSCE_PAT`, or a decision to publish to another registry.

See [[development/release]].
