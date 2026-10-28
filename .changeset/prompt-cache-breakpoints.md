---
"vscode-extension-vercel-ai": patch
---

Ask the gateway to cache the prompt when VS Code marks cache breakpoints in a chat request. The breakpoints used to be dropped with nothing in their place, so models that cache only where told, such as Anthropic's, reprocessed the whole conversation at full input price on every turn of an agent session.
