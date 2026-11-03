---
"vscode-extension-vercel-ai": patch
---

When `vercelAiGateway.inferenceRegion` pins a region and the gateway rejects a chat request as invalid (HTTP 400), the chat error now says the model may have no provider in that region and that the setting can be set to `global` or another region.
