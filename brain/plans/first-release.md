# First release and known gaps

Written 2026-10-20 from `b615407`. This is the only plan so far; the repository has no roadmap file. Each gap is already recorded in the linked notes. Delete this note once the first release is published.

## Release steps

1. Done 2026-10-20: `RELEASE_ENABLED` is `true`, and `GIT_TOKEN` and `VSCE_PAT` exist ([[development/release]]).
2. Done 2026-10-20: the `Release` run opened the "Version Packages" pull request (#48), `0.4.1` to `0.5.0`, from the pending changesets including the minor `connection-check-command.md`.
3. Pending: confirm `VSCE_PAT` is valid (Marketplace `Manage` scope for publisher `SferaDev`, not expired). The owner does this; it cannot be read from the repository. The `needs-human` label on #48 holds the merge until then, because HQ would otherwise land it.
4. Pending: remove `needs-human` and merge #48. The next run finds no changesets, runs `scripts/release.sh`, and publishes if the version differs from the listed one.
5. Pending: check the Marketplace listing and `CHANGELOG.md`. No git tag is created (`privatePackages.tag: false`).

## Known gaps

- Open VSX is not published to, and no record says whether it is wanted ([[decisions/2026-10-08-release-gated-on-variable]]).
- No test launches VS Code; `pnpm package` and the `manifest` tests in [[development/testing]] are the only checks of the manifest.
- It is unknown whether the `Canceled` and `AuthCancelledError` names survive `authentication.getSession`; verify in a real VS Code ([[architecture/chat-provider]]).
