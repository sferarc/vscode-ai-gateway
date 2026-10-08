# Toolchain

## Node and pnpm

`mise.toml` pins Node `26.10.0` and pnpm `12.10.1`, with `lockfile = true`; `mise.lock` records their checksums. `package.json` `packageManager` names the same pnpm. After changing a version in `mise.toml`, run `mise lock` and commit both files.

## Commands

From `package.json` `scripts`:

```bash
pnpm install --frozen-lockfile
pnpm lint        # biome check, read-only
pnpm fix         # biome check --write
pnpm knip        # unused files, exports and dependencies
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # bunchee bundles src/extension.ts to out/ as CommonJS, dependencies inlined
pnpm package     # prepackage runs build, then vsce package --no-dependencies
pnpm changeset   # describe a change for the next release
```

`pnpm dev` rebuilds on change; `.vscode/launch.json` and `.vscode/tasks.json` hold the editor's debug setup. `pnpm package` writes `vscode-extension-vercel-ai-<version>.vsix`, which `.gitignore` excludes. On 2026-10-08 it was 11 files, 202 kB, and vsce warned that the bundled chunk is about 1 MB. `.vscodeignore` keeps sources, configs and the lockfile out of the package.

`pnpm install` also installs the lefthook hooks (`lefthook.yml`): pre-commit runs `biome check --write` on staged JS, TS and JSON files and restages them; commit-msg refuses Claude Code attribution trailers, footers, session links and an Anthropic author.

## Style

`biome.json`: tabs, 100 columns, the recommended preset with a few rules turned off. Markdown is not formatted.

## TypeScript

`tsconfig.json`: ES2024 target, `module` `ESNext`, `moduleResolution` `Bundler`, `strict`, types limited to `node`. The compiler is TypeScript 7; `@typescript/typescript6` stays only because bunchee looks for the TypeScript 6 API by name to emit declarations (`pnpm-workspace.yaml` comment). Remove it once bunchee runs on TypeScript 7 alone.

## Dependencies

Versions live in the `catalog` of `pnpm-workspace.yaml` with `catalogMode: strict`, exact versions, and `package.json` refers to them as `catalog:`. The exception is `@types/vscode`, a literal version equal to the `engines.vscode` floor ([[decisions/2026-07-28-types-vscode-literal]]). `allowBuilds` lets only lefthook run a postinstall. `overrides` carries security floors from the monorepo.

Runtime dependencies are `ai` and `@ai-sdk/gateway`, bundled into `out/` by `build`, which is why `package` passes `--no-dependencies`.
