---
"vscode-extension-vercel-ai": patch
---

Add the `vercelAiGateway.providerSort` setting, which asks the gateway to try a model's providers cheapest first (`cost`), lowest latency first (`ttft`) or highest throughput first (`tps`).
