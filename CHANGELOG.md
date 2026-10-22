# vscode-extension-vercel-ai

## 0.5.3

### Patch Changes

- 3668204: Tag and create the GitHub release after each publish.

## 0.5.2

### Patch Changes

- 9ecad2f: Dismissing the sign-in picker no longer shows an error when VS Code starts the sign-in.

## 0.5.1

### Patch Changes

- 5f4959e: Ship `CHANGELOG.md` inside the installed extension, so the Marketplace page shows the changelog.

## 0.5.0

### Minor Changes

- f3783a5: Add **Vercel AI Gateway: Check Connection**, which tests the active session against the gateway and reports the endpoint, session, HTTP status, latency and model count, and **Vercel AI Gateway: Show Logs**, which opens the extension's log.

### Patch Changes

- 279c7d6: Treat closing a sign-in prompt as a cancellation. Dismissing the method, name, API key, team or project picker no longer shows an error such as "Failed to add session: Team selection cancelled"; real failures still do.
- d73403f: Stop showing an authentication error when you dismiss a picker or prompt while adding a session from the chat model sign-in. Real sign-in failures still show the error.
- cfd0b90: Tell you what to do when a chat request fails: rejected credentials point to "Vercel AI Gateway: Manage Authentication", a rate limit says to wait, and a gateway or provider failure says it is usually temporary. The output log now records the model, HTTP status, URL, retryability and elapsed time of each failed request.
- 4aa0fdb: Stop long chat responses from being cut off after 30 seconds. The timeout setting now limits how long the model may stay silent, and a timeout is reported as an error instead of ending the answer quietly.
- 260fdc5: Accept an endpoint setting with a trailing slash when listing models.
- 1b842e9: Read `vercelAiGateway.endpoint` from user settings only. A workspace `.vscode/settings.json` could point it at another server, and requests to the endpoint carry your API key or OIDC token. The setting is now machine scoped, so it is no longer synced between machines.
- 215284f: Show the underlying cause of network errors, such as `connect ECONNREFUSED` or a certificate failure, instead of only "fetch failed".
- fd70f91: Show the right models right after switching accounts. A model list still loading for the previous account no longer replaces the new account's list for the next five minutes.
- b265815: Explain why the model picker is empty. When the model list cannot be loaded, an error now names the gateway URL and the gateway's reason, with a button to open the logs and, for a rejected key, one to manage authentication. Background refreshes stay quiet.
- 28a0c5d: Keep the model picker usable when the gateway is slow or briefly unreachable. Loading the model list now gives up after the `timeout` setting instead of waiting forever, and a failed refresh keeps showing the last list that loaded instead of an empty picker.
- 80f9cf0: Format the "No response received from model." message with the same bold `Error:` prefix as every other error.
- 91a6221: List every team and project in the Vercel sign-in picker instead of only the first 20, and show the HTTP status when loading them fails.
- 2ccb35b: Stop showing an authentication error when you cancel the Vercel AI Gateway sign-in prompt. Real sign-in failures still show the error.
- f269c7b: Stop capping answers at 4096 tokens and forcing temperature 0.7. Requests now use each model's own output limit and default temperature, and an answer that hits the output limit says so.
- ac04a7f: Keep valid sessions when one stored entry is malformed, instead of deleting every saved API key and Vercel sign-in.
- 5d14640: Stop a session added or removed while an OIDC token refreshes from being lost or brought back, and refresh each token once when several callers ask for it at the same time.
- aeff613: Count attached images and a small per message overhead when estimating a message's tokens, so prompts with screenshots no longer overflow the model's context window.
- 7321f2e: Count tool calls, tool results and textual attachments when estimating a message's tokens, so VS Code no longer treats a long agent conversation as far smaller than it is.
- 998230c: Stop follow-up requests failing after tools that return JSON or images, or after several tools run in parallel. Every tool call now gets its result, and parallel calls are sent together in the shape providers expect.
- 5fe6760: Tell the user, once, when stored sessions cannot be read and have to be added again, with a shortcut to Manage Authentication, and log why without logging the stored content.
- 7177eaf: Stop a stalled connection to Vercel from hanging chat or the OIDC sign-in pickers. Loading teams and projects and refreshing an OIDC token now give up after 15 seconds with "Timed out contacting Vercel", and the next request tries again.
- a583214: Offer Vercel OIDC sign-in on Windows and on platforms other than macOS and Linux by reading the Vercel CLI login from the same folder the CLI writes it to, and ignore an `auth.json` whose token is not a string.
- d7536f1: Stop shipping the repository's contributor notes (`CLAUDE.md` and `brain/`) inside the installed extension.

## 0.4.1

### Patch Changes

- f4792d4: Send the VS Code system prompt as instructions instead of a system message

  VS Code sends its instructions as assistant messages before the first user message. Those were
  rewritten to `system` role messages and left in the `messages` array, which the AI SDK rejects with
  "System messages are not allowed in the prompt or messages fields", breaking every chat request.
  They are now extracted and passed through the `instructions` option, leaving `messages` with only
  user, assistant and tool turns.

- cf4a7e0: Read the active session from our own authentication provider

  Probing for models silently found no credential and reported no models, even with a valid session
  stored. VS Code only hands a session back to a consumer once an access grant has been recorded, and
  sessions created through the provider interface never take that path, so `authentication.getSession`
  answered `undefined` in silent mode. The chat provider now reads the active session straight from
  the authentication provider this extension registers, and only falls back to
  `authentication.getSession` to start the sign-in flow when no session exists yet.

## 0.4.0

### Minor Changes

- 88b4297: Fix account switching, and declare the authentication provider

  - Each authentication session now gets its own account id. Every session previously shared one
    ("vercel-ai-user" for API keys, "vercel-oidc-user" for OIDC), so VS Code could not tell accounts
    apart and switching the active session did not reliably change which credential was used. The
    provider also now declares `supportsMultipleAccounts`, honours the requested account in
    `getSessions`, and the chat provider asks for the active account explicitly instead of relying on
    VS Code's remembered preference. Existing sessions are migrated automatically; because account
    identity changes, VS Code may ask you to pick an account once after updating.
  - Declare the `vercelAiGateway` authentication provider in the manifest, removing the "was not
    declared in the Extension Manifest" warning on activation.
  - Detect model capabilities (vision, tool calling, reasoning) from the structured fields the
    gateway returns, falling back to tag matching only when a field is absent.

## 0.3.0

### Minor Changes

- 53537b0: feat(vscode-ai-gateway): improved streaming and logging

  - Add structured logging using VS Code's native LogOutputChannel
  - Add proper stream chunk handling for text, reasoning, files, tool calls, and errors
  - Add model identity parsing for better family/version extraction
  - Add configurable endpoint and timeout settings
  - Improve message conversion with proper tool result mapping

### Patch Changes

- f92de45: fix(vscode-ai-gateway): refresh models after authentication

  Subscribe to authentication session changes so the model list is re-queried after the user signs in via "Manage Authentication". Previously the provider declared `onDidChangeLanguageModelChatInformation` but never fired it, leaving the Copilot Chat model picker empty until the window was reloaded.

## 0.2.2

### Patch Changes

- c513d19: Fix auth session bugs in VSCode extension

## 0.2.1

### Patch Changes

- da0f1aa: Update docs

## 0.2.0

### Minor Changes

- Migrated to SferaDev monorepo
- Updated repository URLs and package configuration
- Added VSCE release workflow with GitHub CI integration
