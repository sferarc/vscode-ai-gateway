---
"vscode-extension-vercel-ai": minor
---

Add a Manage Provider Keys command that stores your own provider API keys in secret storage and sends them as request-scoped BYOK credentials with chat requests for a model whose provider has a stored key. The gateway then ignores all of the team's dashboard keys on those requests; requests for other providers keep using them.
