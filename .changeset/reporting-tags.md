---
"vscode-extension-vercel-ai": patch
---

Add the `vercelAiGateway.reportingTags` setting, a list of tags recorded with each chat request in AI Gateway's usage reports. The gateway bills each tag as a reporting write. It is read from user settings only.
