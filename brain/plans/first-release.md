# First release and known gaps

Written 2026-10-20 from `b615407`. This is the only plan so far; the repository has no roadmap file. Each gap is already recorded in the linked notes. Delete this note once the first release is published.

## Release steps

1. Done 2026-10-20: `RELEASE_ENABLED` is `true`, and `GIT_TOKEN` and `VSCE_PAT` exist ([[development/release]]).
2. Done 2026-10-20: the `Release` run opened the "Version Packages" pull request (#48), `0.4.1` to `0.5.0`, from the pending changesets including the minor `connection-check-command.md`.
3. Pending: confirm `VSCE_PAT` is valid (Marketplace `Manage` scope for publisher `SferaDev`, not expired). The owner does this; it cannot be read from the repository.
4. Pending: merge #48. The next run finds no changesets, runs `scripts/release.sh`, and publishes if the version differs from the listed one.
5. Pending: check the Marketplace listing and `CHANGELOG.md`. No git tag is created (`privatePackages.tag: false`).

## Known gaps

- Open VSX is not published to, and no record says whether it is wanted ([[decisions/2026-10-08-release-gated-on-variable]]).
- No test launches VS Code; `pnpm package` is the only check of the manifest as VS Code sees it ([[development/testing]]).
- The OIDC session label and the active-session switch on add have no direct test ([[architecture/authentication]]).
- It is unknown whether the `Canceled` error name survives `authentication.getSession`, and `AuthCancelledError` is not recognised by `isSignInCancellation`, so that path still counts as a failure ([[architecture/chat-provider]]).
