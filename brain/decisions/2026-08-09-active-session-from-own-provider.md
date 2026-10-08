# Active session read from this extension's provider

Recorded 2026-08-09, SferaDev/SferaDev#595, released in 0.4.1 (`CHANGELOG.md`).

## Decision

The chat provider gets its credential from `VercelAIAuthenticationProvider.getActiveSession`, passed in by `src/extension.ts`. `authentication.getSession` is used only to start sign-in when no session exists.

## Why

VS Code returns a session to a consumer only after an access grant has been recorded, and sessions created through the provider interface never record one. In silent mode `authentication.getSession` answered `undefined` even with a valid stored session, so the model list came back empty.

## Guard

The `active session` tests in `src/provider.test.ts`. Moving back to `authentication.getSession` alone would bring the empty model list back.
