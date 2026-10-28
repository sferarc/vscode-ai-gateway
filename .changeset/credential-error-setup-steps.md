---
"vscode-extension-vercel-ai": patch
---

Stop showing setup steps that do not apply when the gateway rejects the credentials. The chat error used to repeat the AI SDK's advice to pass an `apiKey` option or set `AI_GATEWAY_API_KEY`, neither of which the extension reads; it now keeps the gateway's reason and points to Manage Authentication.
