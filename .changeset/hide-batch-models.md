---
"vscode-extension-vercel-ai": patch
---

Leave the gateway's batch only models, whose ids end in `-batch`, out of the chat model picker. The gateway rejects them on chat requests, so picking one always failed.
