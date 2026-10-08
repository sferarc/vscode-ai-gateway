# Each session is its own account

Recorded 2026-07-28, SferaDev/SferaDev#563, released in 0.4.0 (`CHANGELOG.md`).

## Decision

A session's account id is its session id. The provider declares `supportsMultipleAccounts`, filters `getSessions` by a requested account, and keeps the active session id in `globalState` ([[architecture/authentication]]). Sessions stored with the old shared ids are rewritten on read in `getSessionsData`.

## Why

Every session used to share `vercel-ai-user` (API keys) or `vercel-oidc-user` (OIDC), so VS Code could not tell accounts apart and switching sessions did not reliably change the credential used.

## Guard

The `accounts` tests in `src/auth.test.ts`. Removing the legacy id rewrite would orphan sessions stored before 0.4.0.
