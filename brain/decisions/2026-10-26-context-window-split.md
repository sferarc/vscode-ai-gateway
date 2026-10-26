# Context window split between input and output

Recorded 2026-10-26.

## Decision

`transformToVSCodeModels` in `src/models.ts` reports `maxOutputTokens` as the gateway's `max_tokens` capped at half of `context_window`, and `maxInputTokens` as `context_window` minus that. Before, `maxInputTokens` was the whole `context_window` and `maxOutputTokens` was `max_tokens` unchanged.

## Why

`context_window` in `GET /v1/models` is the model's total window, input and output together. VS Code budgets the prompt against `maxInputTokens`, and a chat request without a VS Code output limit asks for `maxOutputTokens` ([[architecture/chat-provider]]), so a prompt filled to the old limit plus the default output limit asked for more tokens than the model has. On 2026-10-26, 66 of the 318 `language` models in the public list reported `max_tokens` equal to `context_window` (for example `openai/gpt-oss-120b`, 131072 for both), which made the overflow possible on any non-empty prompt. For a model like `openai/gpt-5` (400000 window, 128000 output) the split gives 272000 input tokens.

Half is a cap chosen so a model whose `max_tokens` fills its window keeps half of it for the prompt. Whether the gateway or the upstream provider clamps an oversized output request on its own is unknown; the split does not depend on it.

## Guard

`token limits` in `src/models.test.ts`. Going back to `maxInputTokens: context_window` would make the full window plus the output limit reachable again.

## Reopen

If the gateway starts reporting a separate input limit, use it instead of the split.
