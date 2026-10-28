---
"vscode-extension-vercel-ai": patch
---

Keep a requested output limit within the model's own. An extension that asks for more output tokens than the model allows now gets the model's limit, and one that sends a limit that is not a whole positive number gets the model's limit instead of an error.
