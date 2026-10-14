---
"vscode-extension-vercel-ai": patch
---

Stop follow-up requests failing after tools that return JSON or images, or after several tools run in parallel. Every tool call now gets its result, and parallel calls are sent together in the shape providers expect.
