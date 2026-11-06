# CI

`.github/workflows/ci.yml`, workflow `CI`, runs on pushes to `main` and on every pull request. One job, `Check`, on `ubuntu-latest`: the repository is public, so GitHub-hosted minutes are free (the workflow's own comment).

## Steps

1. `jdx/mise-action` installs Node and pnpm from `mise.toml`, checked against `mise.lock`.
2. `pnpm install --frozen-lockfile`
3. `pnpm lint`
4. `pnpm exec lefthook validate`. CI never commits, so this only proves `lefthook.yml` loads.
5. `pnpm knip`, two passes. The default pass includes tests. `knip --production --strict` then analyses only what `src/extension.ts` reaches, so an export kept alive only by a test fails. A test seam that must stay exported carries `@internal` with a one-line reason.
6. `pnpm typecheck`
7. `pnpm test`
8. `pnpm build`
9. `xvfb-run --auto-servernum pnpm test:e2e`, the extension host smoke test ([[testing]]). It runs after the build because it loads `out/extension.js`.
10. `pnpm package`. vsce refuses to package when `@types/vscode` is newer than `engines.vscode`, and without this step only the release would find out ([[decisions/2026-07-28-types-vscode-literal]]).
11. `pnpm audit --prod --audit-level high` (#238), below.

`pnpm check` (`package.json`) runs steps 3 to 10 locally (without `xvfb-run`, since a desktop has a display) in the same order and stops at the first failure. Change both together. Step 11 stays out of `pnpm check`: its result depends on the advisory database, not on the code.

## Runtime advisories

The last `Check` step fails on a high or critical advisory in `dependencies` (`ai` and `@ai-sdk/gateway` and what they pull in). `pnpm build` inlines that tree into `out/extension.js` and the VSIX ships it, so an advisory there blocks every pull request and release until it is bumped or accepted. Dev dependencies and moderate or lower advisories do not fail it. Dependabot security updates stay off; dependency bumps keep coming from HQ's updater (sferarc/hq#989).

Accepted advisories go in `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, one GHSA per line with a comment giving the reason and the condition that ends the exception. pnpm reads that list itself, so the CI step passes no `--ignore`. The list was empty when the step landed, since `pnpm audit --prod` found no advisories on 2026-11-06.

Checked on pnpm 12.14.0 on 2026-11-06 against a scratch lockfile holding `lodash@4.17.20`: the step exited 1 on its two high advisories with `ignoreGhsas: []`, and 0 once both were listed, with two moderate advisories still reported.

Actions are pinned to full commit SHAs with the version in a trailing comment, which the sferarc organisation requires. Update both together.

## Weekly dependency refresh

sferarc/hq's `update-dependencies.yml` opens the weekly `chore(deps)` pull request. It runs the `deps:update` task in `mise.toml` in place of its default package steps, and that task (`scripts/update-dependencies.sh`) writes `@types/vscode` back to the `engines.vscode` floor after `pnpm update --latest`. Without it the refresh moved the types to `catalog:` and a newer version (issue #6), which fails `pnpm package`. `src/package.test.ts` fails when the two drift. The rendered `hq-stack.yml` names only this repository since #3, because the repository is public.

## Branch rules on `main`

Read from the GitHub API on 2026-10-08 (rulesets `main-default` and `force-push`): changes through pull requests, merged by squash or rebase; required status check `Check`; linear history; no force pushes; no deletion.

## Related

- [[release]], the other workflow
