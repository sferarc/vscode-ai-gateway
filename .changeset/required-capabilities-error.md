---
"vscode-extension-vercel-ai": patch
---

When `vercelAiGateway.requiredCapabilities` leaves a model with no provider, the chat error now names the setting and the required capabilities instead of blaming only the data policy settings.
