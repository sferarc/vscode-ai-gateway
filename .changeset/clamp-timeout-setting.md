---
"vscode-extension-vercel-ai": patch
---

Keep the `vercelAiGateway.timeout` setting inside its 5000 to 300000 ms range. VS Code accepts any value typed into `settings.json` and only underlines it, so a value of `0` made every model list request time out immediately and a quoted number broke Check Connection. A number outside the range is now clamped to it, and anything that is not a number uses the 30000 ms default.
