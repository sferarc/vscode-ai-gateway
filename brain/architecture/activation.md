# Activation

`package.json` declares one activation event, `onLanguageModelChatProvider:vercelAiGateway`, so VS Code loads the extension only when something asks for models from this vendor. `engines.vscode` is `^1.137.0`.

`activate()` in `src/extension.ts`, in order:

1. Creates the `Vercel AI Gateway` log output channel (`src/logger.ts`, `initializeLogger`).
2. Constructs `VercelAIAuthenticationProvider`, which registers the `vercelAiGateway` authentication provider ([[authentication]]).
3. Constructs `VercelAIChatModelProvider`, passing `authProvider.getActiveSession` as the credential source, and registers it with `vscode.lm.registerLanguageModelChatProvider("vercelAiGateway", ...)` ([[chat-provider]]).
4. Registers the command `vercelAiGateway.manage` ("Vercel AI Gateway: Manage Authentication"), which calls `manageAuthentication()`.

Everything is pushed onto `context.subscriptions`. `activate()` returns `{ authProvider }`; no known consumer uses it. `deactivate()` only logs.

## Manifest contributions

All in `package.json` `contributes`: the `vercelAiGateway` authentication provider (declared since SferaDev/SferaDev#558, which removed an activation warning), the `vercelAiGateway` language model chat provider, the manage command, and the settings in [[configuration]]. `package.json` is the extension manifest, so a change to any of these changes what users see.
