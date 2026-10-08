# CI

`.github/workflows/ci.yml`, workflow `CI`, runs on pushes to `main` and on every pull request. One job, `Check`, on `ubuntu-latest`: the repository is public, so GitHub-hosted minutes are free (the workflow's own comment).

## Steps

1. `jdx/mise-action` installs Node and pnpm from `mise.toml`, checked against `mise.lock`.
2. `pnpm install --frozen-lockfile`
3. `pnpm lint`
4. `pnpm exec lefthook validate`. CI never commits, so this only proves `lefthook.yml` loads.
5. `pnpm knip`
6. `pnpm typecheck`
7. `pnpm test`
8. `pnpm build`
9. `pnpm package`. vsce refuses to package when `@types/vscode` is newer than `engines.vscode`, and without this step only the release would find out ([[decisions/2026-07-28-types-vscode-literal]]).

Actions are pinned to full commit SHAs with the version in a trailing comment, which the sferarc organisation requires. Update both together.

## Branch rules on `main`

Read from the GitHub API on 2026-10-08 (rulesets `main-default` and `force-push`): changes through pull requests, merged by squash or rebase; required status check `Check`; linear history; no force pushes; no deletion.

## Related

- [[release]], the other workflow
