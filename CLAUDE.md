# vscode-ai-gateway

VS Code extension that serves Vercel AI Gateway models through VS Code's Language Model API, published to the VS Code Marketplace as `SferaDev.vscode-extension-vercel-ai`. `README.md` is the user documentation; `package.json` is also the extension manifest.

## Knowledge Base

Read `brain/` files relevant to your task before acting. Update after changes.

| Topic | Doc |
| --- | --- |
| Activation and manifest contributions | `brain/architecture/activation.md` |
| Chat provider: models, requests, token counts | `brain/architecture/chat-provider.md` |
| Settings and constants | `brain/architecture/configuration.md` |
| API key and OIDC sessions, secret storage | `brain/architecture/authentication.md` |
| Node, pnpm, mise, commands | `brain/development/toolchain.md` |
| Tests | `brain/development/testing.md` |
| CI and branch rules | `brain/development/ci.md` |
| Releasing to the Marketplace | `brain/development/release.md` |
| Decisions, dated | `brain/decisions/index.md` |
| Plans | `brain/plans/index.md` |

## Brain

The `brain/` directory is an Obsidian vault: persistent notes on how the extension works and why.

- **Read first.** Read brain files relevant to your task before acting.
- **Write** after mistakes, corrections, or notable learnings about the code.
- **Structure:** One topic per file. Directories with `[[wikilink]]` indexes.
- **Verifiable:** Cite the file, test, commit or pull request behind a claim, and mark unknowns as unknown. Pull requests from before the split are `SferaDev/SferaDev#N`.
- **Public:** This repository is public. Keep notes to the code and the project's own process.
- **Maintain:** Delete outdated notes rather than letting them drift.

## Ground rules

- Run `pnpm lint`, `pnpm exec lefthook validate`, `pnpm knip`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm package` before opening a pull request. CI's `Check` job runs the same and is required.
- Keep `@types/vscode` equal to the `engines.vscode` floor; raising one means raising both (`brain/decisions/2026-07-28-types-vscode-literal.md`).
- Credentials live only in `SecretStorage` (`src/auth.ts`). Never log a key or token.
- Add a changeset (`pnpm changeset`) for a change users should see.
- No em or en dashes in prose. Commit subjects in the imperative, with a conventional prefix.
- Never publish, tag, bump the version or set `RELEASE_ENABLED`: releases are the owner's step (`brain/development/release.md`).
