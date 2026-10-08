# System prompt sent as instructions

Recorded 2026-08-09, SferaDev/SferaDev#596, released in 0.4.1 (`CHANGELOG.md`).

## Decision

VS Code sends its system prompt as assistant messages before the first user message. `convertMessages` in `src/provider.ts` extracts them and passes them to `streamText` as `instructions`; `messages` carries only user, assistant and tool turns.

## Why

They had been rewritten to `system` messages inside `messages`, which the AI SDK rejects ("System messages are not allowed in the prompt or messages fields"), so every chat request failed.

## Guard

The `instruction extraction` tests in `src/provider.test.ts`.
