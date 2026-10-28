# Activation

`package.json` declares one activation event, `onLanguageModelChatProvider:vercelAiGateway`, so VS Code loads the extension only when something asks for models from this vendor. `engines.vscode` is `^1.137.0`.

`activate()` in `src/extension.ts`, in order:

1. Creates the `Vercel AI Gateway` log output channel (`src/logger.ts`, `initializeLogger`).
2. Constructs `VercelAIAuthenticationProvider`, which registers the `vercelAiGateway` authentication provider ([[authentication]]).
3. Constructs `VercelAIChatModelProvider`, passing `authProvider.getActiveSession` as the credential source, and registers it with `vscode.lm.registerLanguageModelChatProvider("vercelAiGateway", ...)` ([[chat-provider]]).
4. Registers the command `vercelAiGateway.manage` ("Vercel AI Gateway: Manage Authentication"), which calls `manageAuthentication()`.
5. Registers `vercelAiGateway.checkConnection` ("Check Connection") and `vercelAiGateway.showLogs` ("Show Logs").

## Diagnostics commands

Check Connection runs `runConnectionCheck` in `src/diagnostics.ts`. It reads the active session through `authProvider.getActiveSession()` (so an expiring OIDC token is refreshed first), then sends its own `GET {endpoint}/v1/models` with the configured timeout instead of going through `ModelsClient`, so the result never comes from the five minute model cache. It reports the endpoint, the session label and method, the OIDC expiry, the HTTP status, the latency, and "Chat models: N of M listed": M is the number of entries in `data` and N the ones `isChatModel` in `src/models.ts` keeps, the same filter that builds the model picker. Before this it showed M alone, which on 2026-10-28 was 498 for the public list against 320 language models in the picker, the rest being embedding, image, video, speech and other types. Test: "counts only the chat models the picker offers apart from the total" in `src/diagnostics.test.ts`. After a model list that succeeds it sends `GET {endpoint}/v1/credits` with the same token and timeout, the endpoint `getCredits` in `@ai-sdk/gateway` reads, and shows "Credits: B left, U used" from the reply's `balance` and `total_used`, passed through as the gateway sends them, so a user whose requests fail can see whether the team is out of credits. No `x-vercel-ai-gateway-team` header is sent, so the balance is the one the gateway resolves for the token; which team that is for an OIDC token is untested. A refused request, a body without both amounts or a network failure leaves the line out and logs the reason at info; it never fails the check. On 2026-10-28 the public endpoint answered a request without credentials with 401 `authentication_error`; whether an API key or an OIDC token can read the balance is untested. Tests: "reports the credit balance after the model list" and "still passes without a balance after ..." in `src/diagnostics.test.ts`. With no session it sends nothing. The result goes to the log at info and to an information or error message with a Show Logs button. The token is only ever in the `Authorization` header; `src/diagnostics.test.ts` asserts it never reaches the message or the log.

Show Logs calls `logger.show()`, which reveals the `Vercel AI Gateway` output channel without taking focus.

Everything is pushed onto `context.subscriptions`. `activate()` returns nothing, so the extension exposes no API to other extensions. `deactivate()` only logs.

## Manifest contributions

All in `package.json` `contributes`: the `vercelAiGateway` authentication provider (declared since SferaDev/SferaDev#558, which removed an activation warning), the `vercelAiGateway` language model chat provider, the manage, check connection and show logs commands, and the settings in [[configuration]]. `package.json` is the extension manifest, so a change to any of these changes what users see. `src/package.test.ts` checks the commands, provider ids and activation events against `activate()` and `EXTENSION_ID`.
