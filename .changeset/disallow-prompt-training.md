---
"vscode-extension-vercel-ai": patch
---

Add the `vercelAiGateway.disallowPromptTraining` setting, which routes chat requests only to providers that do not train on prompts, and explain the error when a model has no such provider.
