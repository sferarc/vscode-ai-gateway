# Restricted Mode supported as limited

Recorded 2026-11-06, from #271.

## Decision

`package.json` declares `capabilities.untrustedWorkspaces` as `{ "supported": "limited" }` with `restrictedConfigurations` listing `vercelAiGateway.timeout`, `vercelAiGateway.providerSort` and `vercelAiGateway.providerOrder`, the settings `getConfig()` in `src/config.ts` reads with `config.get` and so from any scope. In an untrusted folder VS Code returns only the user value of those three (https://code.visualstudio.com/api/extension-guides/workspace-trust); every other setting is already read from user settings only, except that `disallowPromptTraining` and `zeroDataRetention` take a workspace `true`, which can only narrow the providers.

## Why

Without the declaration VS Code treats the extension as not supporting Workspace Trust and disables it in Restricted Mode, so the gateway models left the chat picker whenever a repository was opened without trust. Nothing in the extension reads workspace files: credentials come from SecretStorage, the Vercel CLI login and `AI_GATEWAY_API_KEY` from the user profile and environment. Declaring `true` instead would let an untrusted folder set the provider order or a short timeout.

Whether VS Code's chat offers third party models in Restricted Mode is not checked in a real window here.

## Guard

"stays enabled in Restricted Mode and restricts every setting a workspace can set" in `src/package.test.ts` fails when a setting read with `config.get` is missing from `restrictedConfigurations`. Reopen this if a setting needs a workspace value in untrusted folders, or if the extension starts reading workspace files.

See [[architecture/activation]] and [[decisions/2026-10-15-endpoint-user-settings-only]].
