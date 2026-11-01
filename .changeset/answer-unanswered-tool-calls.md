---
"vscode-extension-vercel-ai": patch
---

Keep a chat working when a tool call in its history has no result: the call now gets a placeholder result instead of failing every later request with "Tool result is missing for tool call".
