---
"vscode-extension-vercel-ai": patch
---

Add the `vercelAiGateway.reasoningEffort` setting, which asks chat models to reason less or more, from `none` to `max`, through the AI SDK's portable reasoning option. Models without configurable reasoning ignore it. It is read from user settings only.
