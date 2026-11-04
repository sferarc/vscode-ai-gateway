---
"vscode-extension-vercel-ai": patch
---

Log the service tier the provider actually served next to the requested `vercelAiGateway.serviceTier` when a chat request completes, so you can see in the output channel whether a `flex` or `priority` request got that tier.
