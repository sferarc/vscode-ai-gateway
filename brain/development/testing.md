# Testing

Vitest, no config file: `pnpm test` runs every `src/**/*.test.ts`. On 2026-10-15 that was 6 files and 145 tests. Each file that touches the editor API replaces it with `vi.mock("vscode", ...)`, so the tests run in Node without a VS Code instance.

| File | Describe blocks and what they cover |
| --- | --- |
| `src/auth.test.ts` | `VercelAIAuthenticationProvider`: session storage, OIDC refresh on read, removal, API key sessions. `active session tracking`. `concurrent session writes`: serialized writes and one shared OIDC refresh across readers. `manageAuthentication`: create, switch, remove, cancel. `authentication method options`: API key only, or OIDC too when the Vercel CLI is logged in. `accounts`: per-session account ids and legacy migration. `stored session parsing`: malformed entries are dropped without losing valid ones |
| `src/vercel-auth.test.ts` | `checkVercelCliAvailable`. `refreshOidcToken`: expiry, team scoping, malformed responses. `Vercel CLI token location`: the `auth.json` folder per platform. `refresh margin`. `createInteractiveOidcSession`: team and project paging, page cap, encoded ids, error status |
| `src/provider.test.ts` | `session change refresh`. `active session`, with `sign-in fallback`: silent and prompted paths, cancelled sign-in, no token in logs. `provideLanguageModelChatResponse`: instructions, output limit and model options, idle chunk timeouts and abort parts. `isValidMimeType`. `handleStreamChunk`. `convertMessages`. `tool message conversion`: JSON and image results, placeholders, grouped parallel calls. `instruction extraction` |
| `src/models.test.ts` | `ModelsClient`, with `capability detection`. `models cache`: freshness, in-flight sharing per key, invalidation, failed fetches |
| `src/models/identity.test.ts` | `parseModelIdentity` |
| `src/logger.test.ts` | `Logger` and `extractErrorMessage` |

There are no integration tests that launch VS Code (`.vscode-test/` is only in `.gitignore` and `.vscodeignore`). The `pnpm package` step in [[ci]] is the only check of the manifest as VS Code sees it.
