---
"vscode-extension-vercel-ai": patch
---

Stop telling you to sign in again when a gateway rule refuses a chat request. A 403 from a routing or policy rule was reported as rejected credentials with a pointer to Manage Authentication; the chat now says a gateway rule refused the request, names the rule when the gateway sends one, and suggests checking the team's AI Gateway rules or picking another model.
