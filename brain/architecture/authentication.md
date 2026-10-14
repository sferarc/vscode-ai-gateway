# Authentication

`VercelAIAuthenticationProvider` in `src/auth.ts` registers the `vercelAiGateway` authentication provider with `supportsMultipleAccounts: true`. It is the only place credentials are stored, and the code a reviewer should read most carefully.

## Storage

- All sessions are one JSON array in VS Code `SecretStorage` under `vercelAiGateway.sessions` (`context.secrets`).
- Every read-modify-write of that array runs through `withLock`, a promise chain, and re-reads the array inside it, so concurrent `getSessions`, `getActiveSession`, add and remove calls cannot drop or resurrect a session. Concurrent refreshes of one OIDC session share a single request (`inflightRefresh`).
- The active session id is in `globalState` under `vercelAiGateway.activeSession`. It is an id, not a secret.
- Nothing is written to disk by the extension itself.

## Methods

- **API key.** Entered in an input box; it must start with `vck_` (`validateApiKey`). Used as the bearer token as is.
- **Vercel OIDC.** Offered only when the Vercel CLI is logged in: `src/vercel-auth.ts` reads `com.vercel.cli/auth.json` under the platform data directory and accepts only a non-empty string `token`. With that token it lets the user pick a team and project and requests a project OIDC token from `api.vercel.com/v1/projects/{id}/token`. The token is refreshed once it is within 15 minutes of expiry (`TOKEN_REFRESH_MARGIN`), on `getSessions` and `getActiveSession`; a failed refresh logs and keeps the old token.

## Vercel CLI login location

`getUserDataDir` mirrors the CLI's own resolution: `packages/cli-config/src/paths.ts` in vercel/vercel (`getGlobalPathConfig`, `XDGAppPaths('com.vercel.cli').dataDirs()`) through xdg-app-paths 5.1.0 and xdg-portable 7.3.0 (`src/lib/index.js`, pinned in the vercel/vercel lockfile), checked at vercel/vercel `c628be7`.

| Platform | Data directory |
| --- | --- |
| Any, with `XDG_DATA_HOME` set | `$XDG_DATA_HOME` |
| darwin | `~/Library/Application Support` |
| win32 | `%APPDATA%\xdg.data`, or `~\AppData\Roaming\xdg.data` without `APPDATA` (not `%LOCALAPPDATA%`) |
| linux and anything else | `~/.local/share` |

Not mirrored: the CLI also falls back to an existing `XDG_DATA_DIRS` entry, `~/.now` or a legacy `now` data directory, honours `--global-config`, and can keep credentials in the OS keyring (`cred-storage.ts`) instead of `auth.json`. A login stored any of those ways is not detected.

## Accounts and the active session

Each session's account id is its own session id. Sessions stored with the old shared ids `vercel-ai-user` or `vercel-oidc-user` are rewritten on read ([[decisions/2026-07-28-per-session-account-ids]]). `getSessions` honours a requested account and sorts the active session first.

The chat provider reads the active session straight from this provider through the `getActiveSession` callback wired in `src/extension.ts`, and only calls `authentication.getSession` to start sign-in when none exists ([[decisions/2026-08-09-active-session-from-own-provider]]).

## Manage command

`vercelAiGateway.manage` opens a quick pick: add, switch (with more than one session), remove, cancel. With no sessions it goes straight to add.

## Tests

`src/auth.test.ts` (sessions, active session tracking, the manage flow, method options, accounts) and `src/vercel-auth.test.ts` (CLI detection and its per-platform paths, `auth.json` variants, the refresh margin boundary, OIDC refresh), added largely in SferaDev/SferaDev#560.
