---
"vscode-extension-vercel-ai": patch
---

Stop a stalled connection to Vercel from hanging chat or the OIDC sign-in pickers. Loading teams and projects and refreshing an OIDC token now give up after 15 seconds with "Timed out contacting Vercel", and the next request tries again.
