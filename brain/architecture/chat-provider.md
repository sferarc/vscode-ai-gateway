# Chat provider

`VercelAIChatModelProvider` in `src/provider.ts` implements VS Code's `LanguageModelChatProvider`.

## Model list

`provideLanguageModelChatInformation` gets a key from the active session ([[authentication]]) and returns `[]` without one, or when the fetch fails. `ModelsClient` (`src/models.ts`) calls `GET {endpoint}/v1/models` with a bearer token, keeps only models whose `type` is `chat`, `language` or absent, and maps them to `LanguageModelChatInformation`:

- `family` and `version` come from `parseModelIdentity` (`src/models/identity.ts`).
- `maxInputTokens` and `maxOutputTokens` come from `context_window` and `max_tokens`.
- Image input, tool calling and reasoning are read from the gateway's structured fields, falling back to tags only when a field is absent (SferaDev/SferaDev#559). Web search is tags only, since no field exists.

The list is cached for 5 minutes (`MODELS_CACHE_TTL_MS`, `src/constants.ts`) and concurrent fetches share one request. Any session change on the `vercelAiGateway` provider clears the cache and fires `onDidChangeLanguageModelChatInformation` (SferaDev/SferaDev#344).

## Chat requests

`provideLanguageModelChatResponse` builds an AI SDK gateway provider (`createGatewayProvider` from `@ai-sdk/gateway`) with the session's token and `baseURL` `{endpoint}/v1/ai`, then streams with `streamText` from `ai`. Defaults when VS Code passes none: temperature `0.7`, `maxOutputTokens` `4096`. The request timeout is the `timeout` setting ([[configuration]]). Cancellation aborts the stream through an `AbortController`.

`convertMessages` splits VS Code's messages into `messages` and `instructions`. VS Code sends its system prompt as assistant messages before the first user message; those go to the `instructions` option because the AI SDK rejects `system` messages inside `messages` ([[decisions/2026-08-09-system-prompt-as-instructions]]).

Errors are reported into the chat as a `**Error:**` text part rather than thrown; a stream that ends with no content reports "No response received from model."

## Token counting

`provideTokenCount` estimates `ceil(characters / 4)` over text parts only, as it has since the extension moved into the monorepo (SferaDev/SferaDev#20). It is not a tokenizer.

## Tests

`src/provider.test.ts`, `src/models.test.ts` and `src/models/identity.test.ts` ([[development/testing]]).
