# Authentication

`VercelAIAuthenticationProvider` in `src/auth.ts` registers the `vercelAiGateway` authentication provider with `supportsMultipleAccounts: true`. It is the only place credentials are stored, and the code a reviewer should read most carefully.

## Storage

- All sessions are one JSON array in VS Code `SecretStorage` under `vercelAiGateway.sessions` (`context.secrets`).
- Every read-modify-write of that array runs through `withLock`, a promise chain, and re-reads the array inside it, so concurrent `getSessions`, `getActiveSession`, add and remove calls cannot drop or resurrect a session. Concurrent refreshes of one OIDC session share a single request (`inflightRefresh`) (#10).
- The active session id is in `globalState` under `vercelAiGateway.activeSession`. It is an id, not a secret.
- Nothing is written to disk by the extension itself.
- Reading the array validates each entry: one without a string `id`, a string `accessToken` or an `account` with string `id` and `label` is dropped with a warning that gives only the count, and its valid siblings are kept. The next write (add, remove, token refresh) persists only the valid entries. A blob that parses to something other than an array reads as no sessions and is left in place; only JSON that does not parse at all deletes the secret. That delete runs in the write queue and only if the secret still holds the unreadable value, so a session stored meanwhile survives. Each of these cases logs a warning (error name and blob length, the parsed type, or the dropped count; never the stored content) and shows one warning per provider instance that the sessions must be added again, with a "Manage Authentication" action. Tests: `stored session parsing` in `src/auth.test.ts` ("keeps valid sessions when a sibling entry has no account", "drops entries without a string id or access token", "returns no sessions when the blob parses to %s", "keeps the other valid session when removing one next to a bad entry") and "handles corrupted session data gracefully".

## Methods

- **API key.** Entered in an input box; it must start with `vck_` (`validateApiKey`). Used as the bearer token as is.
- **Vercel OIDC.** Offered only when the Vercel CLI is logged in: `src/vercel-auth.ts` reads `com.vercel.cli/auth.json` under the platform data directory and accepts only a non-empty string `token`. With that token it lets the user pick a team (or "Personal Account") and then a project, and requests a project OIDC token with a `POST` to `api.vercel.com/v1/projects/{id}/token`. The token is refreshed once it is within 15 minutes of expiry (`TOKEN_REFRESH_MARGIN`), on `getSessions` and `getActiveSession`; a failed refresh logs and keeps the old token.
  - Teams (`/v2/teams`) and projects (`/v10/projects`, with `teamId` when a team was picked) load through `fetchAllPages` (#9): `limit=100` per request (`PAGE_LIMIT`), and each response's `pagination.next` is sent back as `until` until it is null. It stops after 20 pages (`MAX_PAGES`), logs `Stopped loading {teams|projects} after 20 pages` at warn and offers what it has, so an account with more than 2000 teams or projects sees a truncated picker.
  - A non-OK response throws `Failed to fetch {teams|projects}: {status} {statusText}`; `selectTeam` and `selectProject` wrap it as `Failed to load teams: ...` or `Failed to load projects: ...`.
  - Every `api.vercel.com` request (each teams or projects page, and the token `POST`) runs through `withVercelTimeout`: it aborts the fetch and rejects with `VercelOidcTokenError` `Timed out contacting Vercel after 15000 ms` once `VERCEL_API_TIMEOUT_MS` passes, covering the body read too. The rejection is raced against the request, so it settles even if the fetch ignores the abort. Refresh runs on the chat request path, so before this a stalled connection hung chat and, because `inflightRefresh` shares one request, every waiter with it; now the shared promise rejects, its entry is dropped in `finally`, waiters keep the old token and the next call starts a new request. Tests: `Vercel API timeout` in `src/vercel-auth.test.ts` and "starts a new OIDC refresh after a shared one times out" in `src/auth.test.ts`.
  - Tests: `createInteractiveOidcSession` in `src/vercel-auth.test.ts` ("offers projects from every page and passes pagination.next as until", "offers teams from every page", "stops at the page cap when pagination.next never ends", "includes the HTTP status when statusText is empty").

## Adding a session

`createSession` in `src/auth.ts` is what VS Code calls on sign-in, and what the manage command's add action calls.

1. `promptForAuthMethod` always offers "API Key" and offers "Vercel OIDC" only when `checkVercelCliAvailable()` is true. Dismissing the pick throws `AuthCancelledError` (`src/errors.ts`) `Authentication method required`. Tests: `authentication method options` in `src/auth.test.ts`.
2. API key: an input box asks for a session name (required, `validateSessionName`), then a second one asks for the key (masked, `vck_` prefix). Either one dismissed throws `AuthCancelledError` `Session name required` or `API key required`. The account label is the session name.
3. Vercel OIDC: `createOidcSession` checks the CLI login again and, if it is gone, shows `ERROR_MESSAGES.VERCEL_CLI_NOT_LOGGED_IN` (`src/constants.ts`) and throws it. Otherwise it runs the team and project pickers above. The account label is `{projectName} ({teamName})`, or just `{projectName}` when there is no team name (a personal account).
4. `storeSession` appends the session inside `withLock` and makes it the active session, then fires an `added` change event.

Dismissing the team or project picker also throws `AuthCancelledError` (`Team selection cancelled`, `Project selection is required`), which `src/vercel-auth.ts` passes through rather than wrapping as `VercelOidcTokenError`. The manage command catches it, logs it at debug and shows nothing; any other error is logged and shown as `Failed to {action} session: ...` (#31). Before #31 a cancel was told apart by string checks that matched no current message, so it surfaced as a failure toast. Tests: `cancelling a prompt` in `src/auth.test.ts`.

Only "creates API key session" in `src/auth.test.ts` drives this end to end; the OIDC label and the active-session switch on add have no direct test (unknown whether covered indirectly).

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

`vercelAiGateway.manage` opens a quick pick: add, switch ("Switch active session", only with more than one session), remove, cancel. With no sessions it goes straight to add.

## Tests

`src/auth.test.ts` (sessions, active session tracking, the manage flow, method options, accounts) and `src/vercel-auth.test.ts` (CLI detection and its per-platform paths, `auth.json` variants, the refresh margin boundary, OIDC refresh), added largely in SferaDev/SferaDev#560.
