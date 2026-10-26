---
"vscode-extension-vercel-ai": patch
---

Hand a malformed tool call back to VS Code instead of ending the answer with an error. When a model called a tool that does not exist or sent tool input that is not valid JSON, the chat showed an error next to a tool call carrying the raw text as its input; the call now reaches VS Code with an object input so the agent can answer it and the model can retry.
