# Toolchain

## Node and pnpm

`mise.toml` pins Node `26.11.1` and pnpm `12.11.2` (since #5), with `lockfile = true`; `mise.lock` records their checksums. A fresh clone needs `mise trust` before `mise install`, or mise refuses to read the config. `package.json` `packageManager` names the same pnpm. After changing a version in `mise.toml`, run `mise lock` and commit both files.

## Commands

From `package.json` `scripts`:

```bash
pnpm install --frozen-lockfile
pnpm check       # every CI Check step below, in CI's order, stopping at the first failure
pnpm lint        # biome check, read-only
pnpm fix         # biome check --write
pnpm knip        # unused files, exports and dependencies, then a production pass that ignores tests
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # bunchee bundles src/extension.ts to out/ as CommonJS, dependencies inlined
pnpm package     # prepackage runs build, then vsce package --no-dependencies
pnpm changeset   # describe a change for the next release
```

`pnpm dev` rebuilds on change. F5 (Run Extension in `.vscode/launch.json`) starts the default build task in `.vscode/tasks.json`, which runs `pnpm dev --sourcemap` so breakpoints in `src/*.ts` bind against `out/extension.js.map`. bunchee prints no tsc-style watch lines, and only reports rebuilds when stdout is a terminal: a spinner line `Building...` at the start and `✔ Built in <n>ms` at the end, even after a failed rebuild. The task's inline problem matcher uses those two lines as its background begin and end patterns, and turns the `[Error: × <message>` line plus the `╭─[<file>:<line>:<col>]` line that follows into a problem. If a bunchee upgrade changes that wording, F5 waits on the preLaunchTask again; recheck the patterns against `script -q /dev/null pnpm dev`. `pnpm package` writes `vscode-extension-vercel-ai-<version>.vsix`, which `.gitignore` excludes. On 2026-10-16 (`7177eaf`) it was 31 files, 236 kB, and vsce warned that the bundled chunk is about 1 MB. `.vscodeignore` keeps sources, configs and the lockfile out of the package, but not `CLAUDE.md` or `brain/`, which have shipped inside the VSIX since #2 added them (`vsce package` file tree, `git log -- .vscodeignore`).

`pnpm install` also installs the lefthook hooks (`lefthook.yml`): pre-commit runs `biome check --write` on staged JS, TS and JSON files and restages them; commit-msg refuses Claude Code attribution trailers, footers, session links and an Anthropic author.

## Style

`biome.json`: tabs, 100 columns, the recommended preset with a few rules turned off. Markdown is not formatted.

## TypeScript

`tsconfig.json`: ES2024 target, `module` `ESNext`, `moduleResolution` `Bundler`, `strict`, types limited to `node`. `lib` is `ES2024` only, without `DOM`: the extension runs in the Node extension host, and Node's types already declare `fetch`, `Response`, `AbortController` and `TextDecoder`. On top of `strict` it enables `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noImplicitOverride` and `noFallthroughCasesInSwitch`, for tests too: index into an array or record by checking the result (or `?.` in an assertion), not with `!`. The compiler is TypeScript 7; `@typescript/typescript6` stays only because bunchee looks for the TypeScript 6 API by name to emit declarations (`pnpm-workspace.yaml` comment). Remove it once bunchee runs on TypeScript 7 alone.

## Dependencies

Versions live in the `catalog` of `pnpm-workspace.yaml` with `catalogMode: strict`, exact versions, and `package.json` refers to them as `catalog:`. The exception is `@types/vscode`, a literal version equal to the `engines.vscode` floor ([[decisions/2026-07-28-types-vscode-literal]]). `allowBuilds` lets only lefthook run a postinstall. `overrides` carries security floors from the monorepo.

Runtime dependencies are `ai` and `@ai-sdk/gateway`, bundled into `out/` by `build`, which is why `package` passes `--no-dependencies`.
