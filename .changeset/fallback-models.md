---
"vscode-extension-vercel-ai": patch
---

Add the `vercelAiGateway.fallbackModels` setting, a list of models AI Gateway tries in order when every provider of the chosen chat model fails. The answer is then billed at the fallback model's price. It is read from user settings only.
