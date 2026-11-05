---
"vscode-extension-vercel-ai": patch
---

Add the `vercelAiGateway.sessionAffinity` setting. The gateway keeps a chat on the provider that holds its prompt cache, ahead of `providerOrder` and `providerSort`; turning the setting off keeps that order on every turn. It is read from user settings only.
