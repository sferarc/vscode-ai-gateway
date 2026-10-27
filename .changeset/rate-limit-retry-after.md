---
"vscode-extension-vercel-ai": patch
---

Say how long to wait when the gateway rate limits a chat request. When the gateway's reply carries a `Retry-After` header, the error in the chat now names the wait instead of only saying to wait a moment.
