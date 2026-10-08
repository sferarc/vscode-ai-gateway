# Release gated on a repository variable

Recorded 2026-10-08, from `1cf4df1` (the split out of SferaDev/SferaDev) and `.github/workflows/release.yml`.

## Decision

The `Release` job has `if: vars.RELEASE_ENABLED == 'true'`. Until the owner sets that variable, merges to `main` neither open version pull requests nor publish. The workflow comment states why: the first release from this repository is the owner's decision.

The extension is published to the VS Code Marketplace only. The package is `private`, and the workflow comment says nothing goes to npm.

## What would reopen it

The owner enabling releases, which changes the state but not the gate. Publishing to Open VSX would need a new step and a token; no record says whether that is wanted (unknown).

See [[development/release]].
