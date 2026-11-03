# Vercel AI Gateway for VS Code

A VS Code extension that makes [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) models available through the Language Model API, so they appear in VS Code's built-in chat and to any extension that uses that API.

## Features

- **Models listed live from the gateway.** The model list comes from `GET {endpoint}/v1/models` on the configured gateway and is cached for five minutes. Every chat or language model the gateway returns is offered; nothing is hard-coded in the extension. A model the gateway marks as deprecated shows its deprecation date in the picker. Hovering a model shows the gateway's input and output prices per million tokens, the model's knowledge cutoff when the gateway lists one, and whether the providers serving it may train on prompts or offer zero data retention.
- **Capabilities from gateway metadata.** Image input, tool calling and reasoning are read from each model's metadata (input modalities, supported parameters, reasoning options), with the model's tags as a fallback when a field is missing.
- **Streaming responses**, including reasoning output where the model provides it.
- **Cited sources.** When a search model cites web pages, they are listed as numbered links under the answer.
- **Tool calling** with VS Code's tools.
- **Prompt caching.** When VS Code marks cache breakpoints in a request, the gateway is asked to cache the prompt for models that support it.

## Install

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=SferaDev.vscode-extension-vercel-ai), or search for "Vercel AI Gateway" in the Extensions view.

## Sign in

Open the Command Palette (`Cmd/Ctrl + Shift + P`) and run **Vercel AI Gateway: Manage Authentication**. With no sessions yet, it goes straight to adding one and asks for a method:

- **API Key** is always offered.
- **Vercel OIDC** is offered only when the Vercel CLI is logged in on this machine (`vercel login`).

### API key

1. Enter a name for the session, for example Personal or Work.
2. Enter your AI Gateway API key. It must start with `vck_`.

The key is checked with the gateway before it is saved. If the gateway rejects it, the session is not added and the error says so; copy the key again or create a new one. If the gateway cannot be reached, the key is saved unchecked.

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
- **Vercel AI Gateway: Check Connection**: checks the active session against the gateway. It shows the endpoint, the active session and its method, when an OIDC token expires, and the result of a fresh request for the model list: HTTP status, latency, and how many of the listed models are chat models the model picker offers. When the gateway answers a request for the credit balance, it also shows the balance left and the total used. The same details are written to the log; the key or token never is.
- **Vercel AI Gateway: Show Logs**: opens the extension's log.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `vercelAiGateway.endpoint` | `https://ai-gateway.vercel.sh` | AI Gateway endpoint URL. Change it for self-hosted or regional deployments. Read from user settings only: a workspace `.vscode/settings.json` cannot change it, because requests to it carry your key or token. An empty value uses the default. |
| `vercelAiGateway.timeout` | `30000` | Longest time, in milliseconds, the model may stay silent before its first chunk or between any two chunks. Allowed range is 5000 to 300000. When it runs out, the request stops and the chat shows an error saying it timed out. It does not limit the total length of an answer. Loading the model list also gives up after this long. |
| `vercelAiGateway.disallowPromptTraining` | `false` | Sends chat requests only to providers that do not train on prompts, using the gateway's free Disallow Prompt Training option. A model with no such provider fails with an error instead of falling back to one that trains. Turning it on in user or workspace settings is enough; a workspace cannot turn it off. The gateway does not apply it to requests that use your own provider keys (BYOK). |
| `vercelAiGateway.zeroDataRetention` | `false` | Sends chat requests only to providers with zero data retention agreements with Vercel, using the gateway's per-request ZDR option, which needs a Vercel Pro or Enterprise team and costs nothing extra. A model with no such provider fails with an error instead of falling back. Turning it on in user or workspace settings is enough; a workspace cannot turn it off. Your own provider keys (BYOK) are skipped unless you mark them as ZDR in the AI Gateway dashboard. |
| `vercelAiGateway.providerSort` | `default` | Order in which the gateway tries the providers that serve a chat model: `cost` tries the cheapest first, `ttft` the one with the lowest median time to first token, `tps` the one with the highest median tokens per second. The gateway falls back through the others in that order and tries unhealthy providers last. `default` keeps the gateway's own ranking, based on recent uptime and latency. No provider is excluded, so a request cannot fail because of this setting. |
| `vercelAiGateway.providerOrder` | `[]` | Provider slugs the gateway tries first for a chat model, in the order listed, for example `["bedrock", "anthropic"]` to prefer Amazon Bedrock and then Anthropic. The slugs are in the gateway's [list of available providers](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options#available-providers). If the listed providers fail, the gateway falls back to the others, in the `providerSort` order when that is set, so a request cannot fail because of this setting. |
| `vercelAiGateway.providerOnly` | `[]` | Provider slugs a chat request may use, for example `["anthropic"]` to spend Anthropic credits through your own key (BYOK). The gateway routes only to the listed providers and never falls back to others, so a model none of them serve, or whose listed providers are all down or rate limited, fails with an error. `providerOrder` and `providerSort` rank providers inside the list. Only read from user settings, so a workspace cannot narrow it. |

## Troubleshooting

- **Logs.** Run **Vercel AI Gateway: Show Logs**, or open the Output panel and select the **Vercel AI Gateway** channel. Model fetches, chat requests and errors are logged there.
- **Check your setup.** Run **Vercel AI Gateway: Check Connection**. A 401 or 403 means the gateway rejected the key or token; no status means the endpoint could not be reached.
- **No models in the model picker.** Either there is no active session (sign in with Manage Authentication) or fetching the model list failed; the failure is logged in the output channel. Check that `vercelAiGateway.endpoint` points at a reachable gateway.
- **Vercel OIDC is not offered.** The Vercel CLI is not logged in. Run `vercel login` and try again.
- **Spend budget used up (HTTP 402).** A budget on the team, project, API key or team member has reached its limit, and the gateway refuses requests until it resets or is raised. The error names which budget, its spend and its limit.
- **Request rejected as invalid (HTTP 400).** The gateway or the model provider refused the request; the error shows its reason. When the reason is a prompt too long for the model, start a new chat or attach fewer files.
- **No provider meets the data policy (HTTP 400).** With `vercelAiGateway.disallowPromptTraining` or `vercelAiGateway.zeroDataRetention` on, the gateway found no provider of the chosen model that meets it. Pick another model, or turn the setting off.
- **Request timed out.** The model sent nothing for longer than `vercelAiGateway.timeout`, either before its first output or in a pause partway through, in which case the answer above the error is incomplete. Raise the setting for slow models.

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
