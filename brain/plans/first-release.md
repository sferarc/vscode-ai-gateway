# First release and known gaps

Written 2026-10-20 from `b615407`. This is the only plan so far; the repository has no roadmap file. Each release step belongs to the owner, and each gap is already recorded in the linked notes. Delete this note once the first release is published.

## Pending release steps

All of these wait on the owner ([[decisions/2026-10-08-release-gated-on-variable]], [[development/release]]).

1. Set the repository variable `RELEASE_ENABLED` to `true`. Until then the `Release` job is skipped on every push to `main`.
2. Confirm the secrets `GIT_TOKEN` and `VSCE_PAT` exist. The workflow reads both; whether they are set is unknown from the repository.
3. Let the first `Release` run open the "Version Packages" pull request. `.changeset/` holds pending changesets including one minor (`connection-check-command.md`), so the bump from `0.4.1` is to `0.5.0` unless another minor or major lands first.
4. Merge that pull request. The next run finds no changesets, runs `scripts/release.sh`, and publishes `SferaDev.vscode-extension-vercel-ai` to the Marketplace if the version differs from the listed one.
5. Check the Marketplace listing and `CHANGELOG.md` afterwards. No git tag is created (`privatePackages.tag: false`).

## Known gaps

- Open VSX is not published to, and no record says whether it is wanted ([[decisions/2026-10-08-release-gated-on-variable]]).
- No test launches VS Code; `pnpm package` is the only check of the manifest as VS Code sees it ([[development/testing]]).
- It is unknown whether the `Canceled` error name survives `authentication.getSession` ([[architecture/chat-provider]]).
