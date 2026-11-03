---
"vscode-extension-vercel-ai": patch
---

Add the `vercelAiGateway.excludeQuantizations` setting, which skips providers that serve a chat model in a listed weight format such as `fp8` or `int4`. A model whose every provider is excluded fails instead of running on one. It is read from user settings only.
