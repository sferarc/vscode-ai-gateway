# Testing

Vitest, no config file: `pnpm test` runs every `src/**/*.test.ts`. On 2026-10-08 that was 6 files and 85 tests. Each file that touches the editor API replaces it with `vi.mock("vscode", ...)`, so the tests run in Node without a VS Code instance.

| File | Covers |
| --- | --- |
| `src/auth.test.ts` | session storage, active session tracking, the manage flow, which methods are offered, per-session accounts |
| `src/vercel-auth.test.ts` | Vercel CLI detection and OIDC refresh |
| `src/provider.test.ts` | session change refresh, active session lookup, streaming, chunk handling, message conversion, instruction extraction |
| `src/models.test.ts` | the models client and capability detection |
| `src/models/identity.test.ts` | `parseModelIdentity` |
| `src/logger.test.ts` | the logger and `extractErrorMessage` |

There are no integration tests that launch VS Code (`.vscode-test/` is only in `.gitignore` and `.vscodeignore`). The `pnpm package` step in [[ci]] is the only check of the manifest as VS Code sees it.
