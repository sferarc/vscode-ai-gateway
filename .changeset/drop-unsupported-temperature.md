---
"vscode-extension-vercel-ai": patch
---

Stop sending a temperature to models that take none. Chat features and other extensions can ask for a temperature without knowing the model, and the gateway marks some models, such as OpenAI's reasoning models, as not accepting one. The temperature is now left out of requests to those models.
