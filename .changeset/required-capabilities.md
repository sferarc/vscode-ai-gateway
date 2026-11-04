---
"vscode-extension-vercel-ai": patch
---

Add the `vercelAiGateway.requiredCapabilities` setting, which routes chat requests only to providers whose model has every listed capability, such as `free`, `tool-use` or `implicit-caching`. A model with no such provider fails instead of running on another. It is read from user settings only.
