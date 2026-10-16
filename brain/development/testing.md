# Testing

Vitest, no config file: `pnpm test` runs every `src/**/*.test.ts`. On 2026-10-16 (`7177eaf`) that was 9 files and 207 tests. Each file that touches the editor API replaces it with `vi.mock("vscode", ...)`, so the tests run in Node without a VS Code instance.

Tests that depend on token expiry pin the clock: `src/auth.test.ts` and `src/vercel-auth.test.ts` call `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime(NOW)` in `beforeEach`, build every expiry from `NOW`, and restore real timers in `afterEach`. Only `Date` is faked, so promises and `setTimeout` behave as in production. To wait for async work to reach a point, wait on the observable effect (`vi.waitFor(() => expect(mock).toHaveBeenCalled())`) rather than a `setTimeout(0)` flush.

| File | Describe blocks and what they cover |
| --- | --- |
| `src/auth.test.ts` | `VercelAIAuthenticationProvider`: session storage, OIDC refresh on read, removal, API key sessions. `active session tracking`. `concurrent session writes`: serialized writes and one shared OIDC refresh across readers. `manageAuthentication`: create, switch, remove, cancel. `cancelling a prompt`: a dismissed method, name, key, team or project prompt in the manage flow shows nothing, while a failure to load teams still does. `authentication method options`: API key only, or OIDC too when the Vercel CLI is logged in. `accounts`: per-session account ids and legacy migration. `stored session parsing`: malformed entries are dropped without losing valid ones |
| `src/vercel-auth.test.ts` | `checkVercelCliAvailable`. `refreshOidcToken`: expiry, team scoping, malformed responses. `Vercel CLI token location`: the `auth.json` folder per platform. `refresh margin`. `createInteractiveOidcSession`: team and project paging, page cap, encoded ids, error status. `Vercel API timeout`: each `api.vercel.com` request gives up after 15 seconds |
| `src/provider.test.ts` | `session change refresh`. `active session`, with `sign-in fallback`: silent and prompted paths, cancelled sign-in, no token in logs. `model list failures`: the error message and its actions on a prompted load, nothing shown on a silent one. `provideLanguageModelChatResponse`: instructions, output limit and model options, idle chunk timeouts and abort parts. `file chunk MIME validation`. `handleStreamChunk`. `convertMessages`. `tool message conversion`: JSON and image results, placeholders, grouped parallel calls. `instruction extraction`. `provideTokenCount`: text, tool calls and results, textual data parts, images and per message overhead |
| `src/models.test.ts` | `ModelsClient`, with `capability detection`. `models cache`: freshness, in-flight sharing per key, invalidation, the stale fallback, the request timeout, and `fetch failures` (status, gateway message, invalid JSON, a reply without `data`) |
| `src/config.test.ts` | `getConfig endpoint`: workspace and folder values are ignored, and the manifest declares the setting `machine` scoped |
| `src/errors.test.ts` | `describeGatewayError`: status, URL and retryability, `RetryError` unwrapping, credentials and query dropped from the URL |
| `src/models/identity.test.ts` | `parseModelIdentity` |
| `src/logger.test.ts` | `Logger` and `extractErrorMessage` |
| `src/diagnostics.test.ts` | Check Connection: success, rejected credentials, network failure, no session, and that the token never reaches the message or the log |

There are no integration tests that launch VS Code (`.vscode-test/` is only in `.gitignore` and `.vscodeignore`). The `pnpm package` step in [[ci]] is the only check of the manifest as VS Code sees it.
