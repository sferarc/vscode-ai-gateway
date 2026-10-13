---
"vscode-extension-vercel-ai": patch
---

Stop a session added or removed while an OIDC token refreshes from being lost or brought back, and refresh each token once when several callers ask for it at the same time.
