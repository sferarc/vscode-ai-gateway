---
"vscode-extension-vercel-ai": patch
---

Add the `vercelAiGateway.reportingUser` setting, a user ID recorded with each chat request in AI Gateway's usage reports so a team sharing a key can split spend per person. The gateway bills it as a reporting write. It is read from user settings only.
