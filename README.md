# Vercel AI Gateway for VS Code

A VS Code extension that makes [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) models available through the Language Model API, so they appear in VS Code's built-in chat and to any extension that uses that API.

## Features

- **Models listed live from the gateway.** The model list comes from `GET {endpoint}/v1/models` on the configured gateway and is cached for five minutes. Every chat or language model the gateway returns is offered; nothing is hard-coded in the extension.
- **Capabilities from gateway metadata.** Image input, tool calling and reasoning are read from each model's metadata (input modalities, supported parameters, reasoning options), with the model's tags as a fallback when a field is missing.
- **Streaming responses**, including reasoning output where the model provides it.
- **Cited sources.** When a search model cites web pages, they are listed as numbered links under the answer.
- **Tool calling** with VS Code's tools.

## Install

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=SferaDev.vscode-extension-vercel-ai), or search for "Vercel AI Gateway" in the Extensions view.

## Sign in

Open the Command Palette (`Cmd/Ctrl + Shift + P`) and run **Vercel AI Gateway: Manage Authentication**. With no sessions yet, it goes straight to adding one and asks for a method:

- **API Key** is always offered.
- **Vercel OIDC** is offered only when the Vercel CLI is logged in on this machine (`vercel login`).

### API key

1. Enter a name for the session, for example Personal or Work.
2. Enter your AI Gateway API key. It must start with `vck_`.

### Vercel OIDC

1. Pick a team or your personal account.
2. Pick a project.

The extension requests an OIDC token for that project using the Vercel CLI's login and names the session after the project and team. When the token is within 15 minutes of expiring, it is refreshed automatically the next time the session is read, which again needs a logged-in Vercel CLI.

Keys and tokens are kept in VS Code's secret storage.

## Multiple sessions

Run **Vercel AI Gateway: Manage Authentication** again once a session exists. The menu shows the active session and offers:

- **Add new authentication**: add another API key or OIDC session. A new session becomes the active one.
- **Switch active session**: shown when there are two or more sessions.
- **Remove session**: delete a session. Removing the active session makes the first remaining one active.

Chat requests and the model list always use the active session.

## Commands

Run these from the Command Palette:

- **Vercel AI Gateway: Manage Authentication**: add, switch or remove sessions.
- **Vercel AI Gateway: Check Connection**: checks the active session against the gateway. It shows the endpoint, the active session and its method, when an OIDC token expires, and the result of a fresh request for the model list: HTTP status, latency and model count. The same details are written to the log; the key or token never is.
- **Vercel AI Gateway: Show Logs**: opens the extension's log.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `vercelAiGateway.endpoint` | `https://ai-gateway.vercel.sh` | AI Gateway endpoint URL. Change it for self-hosted or regional deployments. Read from user settings only: a workspace `.vscode/settings.json` cannot change it, because requests to it carry your key or token. |
| `vercelAiGateway.timeout` | `30000` | Longest time, in milliseconds, the model may stay silent before its first chunk or between any two chunks. Allowed range is 5000 to 300000. When it runs out, the request stops and the chat shows an error saying it timed out. It does not limit the total length of an answer. Loading the model list also gives up after this long. |

## Troubleshooting

- **Logs.** Run **Vercel AI Gateway: Show Logs**, or open the Output panel and select the **Vercel AI Gateway** channel. Model fetches, chat requests and errors are logged there.
- **Check your setup.** Run **Vercel AI Gateway: Check Connection**. A 401 or 403 means the gateway rejected the key or token; no status means the endpoint could not be reached.
- **No models in the model picker.** Either there is no active session (sign in with Manage Authentication) or fetching the model list failed; the failure is logged in the output channel. Check that `vercelAiGateway.endpoint` points at a reachable gateway.
- **Vercel OIDC is not offered.** The Vercel CLI is not logged in. Run `vercel login` and try again.
- **Request timed out.** The model sent nothing for longer than `vercelAiGateway.timeout`. Raise the setting for slow models.

## Development

The toolchain is pinned in `mise.toml`. With [mise](https://mise.jdx.dev) installed:

```bash
mise trust
mise install
pnpm install
pnpm check
```

`mise trust` is needed once per clone: mise refuses to read a `mise.toml` it has not been told to trust. `pnpm check` runs the same steps as CI's `Check` job, in the same order, and stops at the first failure.

`@types/vscode` stays a literal version equal to the `engines.vscode` floor: `vsce` cannot read the catalog protocol and refuses to package when the types are newer than the engine. Add a changeset with `pnpm changeset` for any change that should be released.

## License

MIT
