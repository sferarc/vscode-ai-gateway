---
"vscode-extension-vercel-ai": patch
---

Use the default gateway when the `vercelAiGateway.endpoint` setting is empty. Clearing the field in the Settings editor saves an empty value, which made every model list and chat request fail with an invalid URL; a value that is not text in `settings.json` made them fail outright. Both now fall back to `https://ai-gateway.vercel.sh`.
