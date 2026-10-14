---
"vscode-extension-vercel-ai": patch
---

Offer Vercel OIDC sign-in on Windows and on platforms other than macOS and Linux by reading the Vercel CLI login from the same folder the CLI writes it to, and ignore an `auth.json` whose token is not a string.
