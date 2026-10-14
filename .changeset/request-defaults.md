---
"vscode-extension-vercel-ai": patch
---

Stop capping answers at 4096 tokens and forcing temperature 0.7. Requests now use each model's own output limit and default temperature, and an answer that hits the output limit says so.
