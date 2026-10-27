---
"vscode-extension-vercel-ai": patch
---

Mark models the gateway lists as deprecated. The model picker showed them like any other model, so a chat could keep using one until the gateway stopped serving it; the picker now shows the deprecation date next to the model and in its tooltip.
