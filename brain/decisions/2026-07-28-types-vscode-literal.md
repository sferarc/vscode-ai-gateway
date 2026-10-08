# `@types/vscode` is a literal version at the engine floor

Recorded 2026-07-28, SferaDev/SferaDev#555; restated in `README.md` and checked by CI since `1cf4df1`.

## Decision

`package.json` lists `@types/vscode` as a literal version (`1.137.0`) rather than `catalog:`, equal to the floor of `engines.vscode` (`^1.137.0`).

## Why

vsce reads the version straight from `package.json` and cannot parse pnpm's `catalog:` protocol. Once it can parse it, vsce refuses to package when the types are newer than `engines.vscode`. Both failures surfaced only in the release job, which is why CI now runs `pnpm package` ([[development/ci]]).

## Consequence

Raising `@types/vscode` means raising `engines.vscode` in the same change, which drops users on older VS Code. A dependency bump must not move the types alone.
