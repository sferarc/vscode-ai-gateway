---
"vscode-extension-vercel-ai": patch
---

Add the `vercelAiGateway.inferenceRegion` setting, which pins chat inference, and any data the provider stores, to the US, the EU, Australia or Japan. A pinned region can cost more, and a model with no provider there fails instead of running elsewhere. It is read from user settings only.
