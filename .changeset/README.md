# Changesets

Run `pnpm changeset` to describe a change that should ship in the next release. The release workflow turns pending changesets into a version PR, and merging that PR publishes. That workflow only runs once the owner sets the repository variable `RELEASE_ENABLED` to `true`; until then pending changesets wait on main. See [brain/development/release.md](../brain/development/release.md).
