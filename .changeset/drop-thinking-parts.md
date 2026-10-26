---
"vscode-extension-vercel-ai": patch
---

Stop sending a reasoning model's earlier thinking back to it as part of its answer. In agent mode, the Copilot Chat extension returns the thinking from earlier steps of the same request, and it reached the model as ordinary assistant text, so the model saw its own reasoning as something it had said and every step paid for those tokens again. Thinking parts are now left out of the request and out of the token estimate.
