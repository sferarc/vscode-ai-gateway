# vscode-extension-vercel-ai

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
