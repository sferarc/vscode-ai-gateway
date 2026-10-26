---
"vscode-extension-vercel-ai": patch
---

Leave room for the answer in each model's context window. The input limit VS Code sees is now the context window minus the output limit, and the output limit is at most half the window, so a long conversation no longer asks the model for more tokens than it has.
