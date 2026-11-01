---
"vscode-extension-vercel-ai": patch
---

Check a new API key with the gateway before saving it. A key the gateway rejects is no longer stored as a session that fails every chat request; adding it shows that the gateway rejected the key instead. Spaces copied around the key are dropped, so a key pasted with a leading space is accepted. When the gateway cannot be reached the key is still saved.
