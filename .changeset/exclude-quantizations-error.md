---
"vscode-extension-vercel-ai": patch
---

When `vercelAiGateway.excludeQuantizations` leaves a model with no provider, the chat error now names the setting and the excluded formats instead of blaming only the data policy settings.
