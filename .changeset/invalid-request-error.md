---
"vscode-extension-vercel-ai": patch
---

A chat request the gateway or the model provider rejects as invalid (HTTP 400) now names the status and shows the gateway's message once, instead of following it with the raw JSON error body. When the prompt is too long for the model, the error suggests starting a new chat or attaching less.
