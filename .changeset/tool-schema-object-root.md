---
"vscode-extension-vercel-ai": patch
---

A tool whose input schema is empty or leaves out `"type": "object"` or `properties` is now sent to the gateway as an object schema, so one such tool no longer fails every chat request that offers it.
