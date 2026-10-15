---
"vscode-extension-vercel-ai": patch
---

Read `vercelAiGateway.endpoint` from user settings only. A workspace `.vscode/settings.json` could point it at another server, and requests to the endpoint carry your API key or OIDC token. The setting is now machine scoped, so it is no longer synced between machines.
