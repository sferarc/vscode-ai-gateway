---
"vscode-extension-vercel-ai": patch
---

Add the `vercelAiGateway.quotaEntity` setting: an entity ID sent with each chat request as the gateway's `quotaEntityId`, so the gateway tracks and enforces quota against that entity. It is read from user settings only.
