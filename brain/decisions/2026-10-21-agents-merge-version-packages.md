# Agents merge the Version Packages pull request

Recorded 2026-10-21, from the owner's decision on #51.

## Decision

Agents may merge the "Version Packages" pull request under the same bar as any other: required checks green and an independent review clean. Merging it publishes to the VS Code Marketplace and the workflow then tags `v<version>`.

The first publish (`0.5.0`, run 39556789195 on #48) proved `VSCE_PAT`, so the earlier hold on that pull request no longer applies. Agents still never publish by hand, bump the version, or set `RELEASE_ENABLED`.

## Scope

The Marketplace is the only target. Nothing goes to Open VSX or npm.

## What would reopen it

A failed publish, an expired `VSCE_PAT`, or a decision to publish to another registry.

See [[development/release]].
