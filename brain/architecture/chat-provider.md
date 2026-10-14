# Chat provider

`VercelAIChatModelProvider` in `src/provider.ts` implements VS Code's `LanguageModelChatProvider`.

## Model list

`provideLanguageModelChatInformation` gets a key from the active session ([[authentication]]) and returns `[]` without one, or when the fetch fails. `ModelsClient` (`src/models.ts`) calls `GET {endpoint}/v1/models` with a bearer token, keeps only models whose `type` is `chat`, `language` or absent, and maps them to `LanguageModelChatInformation`:

- `family` and `version` come from `parseModelIdentity` (`src/models/identity.ts`).
- `maxInputTokens` and `maxOutputTokens` come from `context_window` and `max_tokens`.
- Image input, tool calling and reasoning are read from the gateway's structured fields, falling back to tags only when a field is absent (SferaDev/SferaDev#559). Web search is tags only, since no field exists.

The list is cached for 5 minutes (`MODELS_CACHE_TTL_MS`, `src/constants.ts`). Both the cache and the in-flight request are keyed by the API key they were fetched with: concurrent calls with the same key share one request, and a call with a different key starts its own and never sees another key's list. A failed fetch is not cached. Any session change on the `vercelAiGateway` provider calls `invalidateCache` and fires `onDidChangeLanguageModelChatInformation` (SferaDev/SferaDev#344). `invalidateCache` drops the cache and the in-flight request and bumps a generation counter so a fetch started before the switch cannot write its result into the cache when it lands. The `models cache` tests in `src/models.test.ts` cover sharing, expiry, failures, invalidation during a fetch and a key change during a fetch.

## Getting a key

`getApiKey` is the only place a model-list or chat request gets credentials. It reads the active session from this extension's own provider ([[decisions/2026-08-09-active-session-from-own-provider]]) and falls back to `authentication.getSession` with `createIfNone` only when there is no session and the request may prompt. Without a key the model list is `[]` with no fetch, and a chat request reports `**Error:** Vercel AI Gateway API key not found` in the chat without building a gateway provider.

| Situation | Silent | Prompting |
| --- | --- | --- |
| Reading the active session throws | No key, nothing logged or shown | Error logged, `AUTH_FAILED` toast |
| No session | No key, sign-in not started | Sign-in started |
| User cancels sign-in | Not reached | Logged at info, no toast |
| Sign-in fails otherwise | Not reached | Error logged, `AUTH_FAILED` toast |
| Sign-in resolves no session | Not reached | No key, no toast |

A cancel is recognised by what VS Code rejects with: `User did not consent to login.` when the consent prompt is dismissed, or an error named `Canceled` (`mainThreadAuthentication.ts` in the VS Code repository). Dismissing a picker inside this extension's own `createSession` (`src/auth.ts`) throws its own messages and still counts as a failure. No log line on these paths carries the token. Covered by the `sign-in fallback` tests in `src/provider.test.ts`.

## Chat requests

`provideLanguageModelChatResponse` builds an AI SDK gateway provider (`createGatewayProvider` from `@ai-sdk/gateway`) with the session's token and `baseURL` `{endpoint}/v1/ai`, then streams with `streamText` from `ai`. `modelOptions.temperature` and `modelOptions.maxOutputTokens` are passed through when VS Code sets them. Otherwise temperature is left to the provider, and `maxOutputTokens` is the model's own `maxOutputTokens` when positive and unset when not. The request timeout is the `timeout` setting ([[configuration]]). Cancellation aborts the stream through an `AbortController`.

`convertMessages` splits VS Code's messages into `messages` and `instructions`. VS Code sends its system prompt as assistant messages before the first user message; those go to the `instructions` option because the AI SDK rejects `system` messages inside `messages` ([[decisions/2026-08-09-system-prompt-as-instructions]]).

Each VS Code message becomes at most one assistant message and one tool message. An assistant message keeps its text and every tool call in their original order, and all tool results in a message share one `tool` message, since OpenAI-style APIs reject an assistant message with tool calls that is not followed directly by the results for each call. Tool results precede any user text sent alongside them. Every tool result part produces a result so no call is left without one: text and JSON or other textual data parts become text, joined with no separator; image data parts become `file` content; anything else becomes the placeholder `[Unsupported tool result content]`. `cache_control` data parts are skipped.

Errors are reported into the chat as a `**Error:**` text part rather than thrown; a stream that ends with no content reports "No response received from model." A `finish` part with reason `length` adds a note that the answer was cut off at the model's output token limit.

## Token counting

`provideTokenCount` estimates `ceil(characters / 4)` over text parts only, as it has since the extension moved into the monorepo (SferaDev/SferaDev#20). It is not a tokenizer.

## Tests

`src/provider.test.ts`, `src/models.test.ts` and `src/models/identity.test.ts` ([[development/testing]]).
