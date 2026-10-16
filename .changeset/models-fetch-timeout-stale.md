---
"vscode-extension-vercel-ai": patch
---

Keep the model picker usable when the gateway is slow or briefly unreachable. Loading the model list now gives up after the `timeout` setting instead of waiting forever, and a failed refresh keeps showing the last list that loaded instead of an empty picker.
