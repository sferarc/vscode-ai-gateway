---
"vscode-extension-vercel-ai": patch
---

Say when the gateway could not be reached. A chat request that got no response, because the endpoint did not resolve, refused the connection or timed out connecting, used to be reported as "HTTP 500" with "Invalid error response format", or with advice to raise a Node.js timeout; it now says no response came back and points to the network connection and the `vercelAiGateway.endpoint` setting.
