---
"vscode-extension-vercel-ai": patch
---

Add the `vercelAiGateway.byokProviderTimeouts` setting: per provider slug, how many milliseconds the gateway waits for a provider reached with your team's own keys (BYOK) to start answering before it falls back to the next provider. It is read from user settings only.
