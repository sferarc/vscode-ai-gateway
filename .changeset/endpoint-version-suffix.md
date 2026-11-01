---
"vscode-extension-vercel-ai": patch
---

Accept a `vercelAiGateway.endpoint` setting copied from Vercel's docs with its API version, such as `https://ai-gateway.vercel.sh/v1` (the OpenAI SDK base URL) or `https://ai-gateway.vercel.sh/v4/ai` (the AI SDK one). The extension adds its own `/v1/models` and `/v1/ai` paths, so those values used to request paths like `/v1/v1/models` and got a 404; a trailing `/v<number>` or `/v<number>/ai` is now dropped.
