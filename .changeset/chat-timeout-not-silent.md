---
"vscode-extension-vercel-ai": patch
---

Stop long chat responses from being cut off after 30 seconds. The timeout setting now limits how long the model may stay silent, and a timeout is reported as an error instead of ending the answer quietly.
