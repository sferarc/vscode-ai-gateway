# Authentication

`VercelAIAuthenticationProvider` in `src/auth.ts` registers the `vercelAiGateway` authentication provider with `supportsMultipleAccounts: true`. It is the only place credentials are stored, and the code a reviewer should read most carefully.

## Storage

- All sessions are one JSON array in VS Code `SecretStorage` under `vercelAiGateway.sessions` (`context.secrets`).
- Every read-modify-write of that array runs through `withLock`, a promise chain, and re-reads the array inside it, so concurrent `getSessions`, `getActiveSession`, add and remove calls cannot drop or resurrect a session. Concurrent refreshes of one OIDC session share a single request (`inflightRefresh`).
- The active session id is in `globalState` under `vercelAiGateway.activeSession`. It is an id, not a secret.
- Nothing is written to disk by the extension itself.
- Reading the array validates each entry: one without a string `id`, a string `accessToken` or an `account` with string `id` and `label` is dropped with a warning that gives only the count, and its valid siblings are kept. The next write (add, remove, token refresh) persists only the valid entries. A blob that parses to something other than an array reads as no sessions and is left in place; only JSON that does not parse at all deletes the secret. Tests: `stored session parsing` in `src/auth.test.ts` ("keeps valid sessions when a sibling entry has no account", "drops entries without a string id or access token", "returns no sessions when the blob parses to %s", "keeps the other valid session when removing one next to a bad entry") and "handles corrupted session data gracefully".

## Methods

- **API key.** Entered in an input box; it must start with `vck_` (`validateApiKey`). Used as the bearer token as is.
- **Vercel OIDC.** Offered only when the Vercel CLI is logged in: `src/vercel-auth.ts` reads the CLI's `auth.json` from `com.vercel.cli` under the platform data directory (`XDG_DATA_HOME`, `~/Library/Application Support`, `~/.local/share` or `%LOCALAPPDATA%`). With that token it lets the user pick a team and project and requests a project OIDC token from `api.vercel.com/v1/projects/{id}/token`. The token is refreshed once it is within 15 minutes of expiry (`TOKEN_REFRESH_MARGIN`), on `getSessions` and `getActiveSession`; a failed refresh logs and keeps the old token.

## Accounts and the active session

Each session's account id is its own session id. Sessions stored with the old shared ids `vercel-ai-user` or `vercel-oidc-user` are rewritten on read ([[decisions/2026-07-28-per-session-account-ids]]). `getSessions` honours a requested account and sorts the active session first.

The chat provider reads the active session straight from this provider through the `getActiveSession` callback wired in `src/extension.ts`, and only calls `authentication.getSession` to start sign-in when none exists ([[decisions/2026-08-09-active-session-from-own-provider]]).

## Manage command

`vercelAiGateway.manage` opens a quick pick: add, switch (with more than one session), remove, cancel. With no sessions it goes straight to add.

## Tests

`src/auth.test.ts` (sessions, active session tracking, the manage flow, method options, accounts) and `src/vercel-auth.test.ts` (CLI detection, OIDC refresh), added largely in SferaDev/SferaDev#560.
