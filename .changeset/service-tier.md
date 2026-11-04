---
"vscode-extension-vercel-ai": patch
---

Add the `vercelAiGateway.serviceTier` setting, which asks the gateway for the lower cost `flex` tier or the faster `priority` tier on OpenAI, Google and SpaceXAI models. The gateway bills the tier the provider actually served. It is read from user settings only.
