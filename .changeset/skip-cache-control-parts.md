---
"vscode-extension-vercel-ai": patch
---

Stop sending VS Code's prompt cache markers to the model as text. A cache breakpoint on a chat message used to reach the model as the word "ephemeral" appended to that message; it is now dropped, and a binary attachment the extension cannot convert is sent as a short placeholder instead of undecodable bytes.
