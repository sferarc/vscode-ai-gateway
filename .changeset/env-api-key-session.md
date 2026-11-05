---
"vscode-extension-vercel-ai": minor
---

Use the `AI_GATEWAY_API_KEY` environment variable as the session when none is stored, so dev containers, Codespaces and scripted setups can sign in without prompts. A stored session always wins, and the key is checked with the gateway and never saved.
