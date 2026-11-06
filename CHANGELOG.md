# vscode-extension-vercel-ai

## 0.18.2

### Patch Changes

- 590ca86: Send sign-in prompts, notifications, Check Connection results and chat error messages through VS Code's localization API and ship their English bundle, so locale files can translate them later. The English text is unchanged.

## 0.18.1

### Patch Changes

- 3992295: Move the command titles, setting descriptions and walkthrough text into package.nls.json so VS Code can show them translated.

## 0.18.0

### Minor Changes

- 97fd223: Keep the extension enabled in Restricted Mode, so the gateway models stay in the chat picker in a folder you have not trusted. VS Code ignores workspace values of the timeout, provider sort and provider order settings there until the folder is trusted.

## 0.17.0

### Minor Changes

- 2cac10b: Add the `vercelAiGateway.webSearch` setting, off by default, which lets chat models that call tools search the web through the gateway's Perplexity search tool.

## 0.16.2

### Patch Changes

- 53e362e: Count the pages of a PDF that keeps them in compressed object streams, as pdfTeX and other PDF 1.5 writers do, so its token estimate is no longer that of a single page.

## 0.16.1

### Patch Changes

- 99fecb4: Count the pages of a PDF sent to a model that takes PDF input in token estimates, so VS Code no longer budgets a prompt with a PDF as if the file were free.

## 0.16.0

### Minor Changes

- b152265: Add a Manage Provider Keys command that stores your own provider API keys in secret storage and sends them as request-scoped BYOK credentials with chat requests for a model whose provider has a stored key. The gateway then ignores all of the team's dashboard keys on those requests; requests for other providers keep using them.

## 0.15.0

### Minor Changes

- 70bac89: PDF attachments and PDF tool results now reach models that the gateway lists as taking PDF input, such as Claude, Gemini and GPT models, instead of being replaced with a placeholder. Other models still get the placeholder.

## 0.14.0

### Minor Changes

- f939664: The Vercel AI Gateway Status tool now reports the cost of the last chat request that completed in the VS Code window, with the provider that served it and its token counts, read from the gateway's generation record.

## 0.13.0

### Minor Changes

- f46ca3f: Check Connection now shows the session's spend since the first of the month, with the request count and the three models it went to most, when the gateway returns a spend report, so you can see it without asking an agent.

## 0.12.0

### Minor Changes

- 970b9d3: The Vercel AI Gateway Status tool now lists each model's cache read and cache write prices per million tokens when the gateway lists them, so an agent comparing models for a long session sees what most of its input tokens will cost.

## 0.11.2

### Patch Changes

- 8bf9c33: Add the `vercelAiGateway.quotaEntity` setting: an entity ID sent with each chat request as the gateway's `quotaEntityId`, so the gateway tracks and enforces quota against that entity. It is read from user settings only.

## 0.11.1

### Patch Changes

- 7476f55: Add the `vercelAiGateway.byokProviderTimeouts` setting: per provider slug, how many milliseconds the gateway waits for a provider reached with your team's own keys (BYOK) to start answering before it falls back to the next provider. It is read from user settings only.

## 0.11.0

### Minor Changes

- 3da5670: The Vercel AI Gateway Status tool now says whether each model it lists supports tool calling, image input and reasoning, so an agent can pick a model that can run tools or read images.
- bb5bf8e: The Vercel AI Gateway Status tool now reports the session's spend since the first of the month and the three models it went to most, so an agent can see what a task has cost so far.

## 0.10.0

### Minor Changes

- 8020299: Show the gateway's cache read and cache write prices per million tokens in the model tooltip when it lists them.

## 0.9.2

### Patch Changes

- 1c9c571: Leave the gateway's batch only models, whose ids end in `-batch`, out of the chat model picker. The gateway rejects them on chat requests, so picking one always failed.
- 964a52b: Add the `vercelAiGateway.sessionAffinity` setting. The gateway keeps a chat on the provider that holds its prompt cache, ahead of `providerOrder` and `providerSort`; turning the setting off keeps that order on every turn. It is read from user settings only.

## 0.9.1

### Patch Changes

- 25d0e67: Add the `vercelAiGateway.reasoningEffort` setting, which asks chat models to reason less or more, from `none` to `max`, through the AI SDK's portable reasoning option. Models without configurable reasoning ignore it. It is read from user settings only.

## 0.9.0

### Minor Changes

- 3db20fd: The Vercel AI Gateway Status tool takes a search term and lists up to 20 gateway chat models whose id or name contains it, with their prices and context windows, so an agent can find model ids to compare.

## 0.8.0

### Minor Changes

- 247429b: Add the read-only Vercel AI Gateway Status tool for agent mode (`#gatewayStatus`): it returns the active session's credit balance and the per million token prices and context windows of the gateway models it is asked about.

## 0.7.1

### Patch Changes

- 47318da: Group the README settings into Connection, Privacy, Routing and Spend reporting, each with a short table and its caveats listed below it, so the privacy controls are easy to find on the Marketplace page.
- 9595250: When `vercelAiGateway.requiredCapabilities` leaves a model with no provider, the chat error now names the setting and the required capabilities instead of blaming only the data policy settings.

## 0.7.0

### Minor Changes

- 9606141: Add a Get Started walkthrough that links to creating a gateway key, signs in with Manage Authentication and opens chat. Each step ticks once it is done.

## 0.6.0

### Minor Changes

- e955f13: Use the `AI_GATEWAY_API_KEY` environment variable as the session when none is stored, so dev containers, Codespaces and scripted setups can sign in without prompts. A stored session always wins, and the key is checked with the gateway and never saved.

## 0.5.31

### Patch Changes

- f005577: Reword the Marketplace description and open the README with a three step quick start and a link to create an AI Gateway API key. Both now say the extension is a community extension, not made by Vercel.
- ca13dd6: Show the Free badge and a banner on the Marketplace listing, send Q and A to GitHub issues, and add search keywords such as copilot, byok and the provider names.
- d03b63b: Add the `vercelAiGateway.requiredCapabilities` setting, which routes chat requests only to providers whose model has every listed capability, such as `free`, `tool-use` or `implicit-caching`. A model with no such provider fails instead of running on another. It is read from user settings only.

## 0.5.30

### Patch Changes

- 6659430: Add the `vercelAiGateway.reportingUser` setting, a user ID recorded with each chat request in AI Gateway's usage reports so a team sharing a key can split spend per person. The gateway bills it as a reporting write. It is read from user settings only.

## 0.5.29

### Patch Changes

- e2caa40: Log the service tier the provider actually served next to the requested `vercelAiGateway.serviceTier` when a chat request completes, so you can see in the output channel whether a `flex` or `priority` request got that tier.

## 0.5.28

### Patch Changes

- eeeff14: Add the `vercelAiGateway.serviceTier` setting, which asks the gateway for the lower cost `flex` tier or the faster `priority` tier on OpenAI, Google and SpaceXAI models. The gateway bills the tier the provider actually served. It is read from user settings only.

## 0.5.27

### Patch Changes

- 4ba5405: When `vercelAiGateway.excludeQuantizations` leaves a model with no provider, the chat error now names the setting and the excluded formats instead of blaming only the data policy settings.

## 0.5.26

### Patch Changes

- 9819cdb: Add the `vercelAiGateway.excludeQuantizations` setting, which skips providers that serve a chat model in a listed weight format such as `fp8` or `int4`. A model whose every provider is excluded fails instead of running on one. It is read from user settings only.
- 608b5cc: Show in the model tooltip which inference regions the model serves, so a pinned `vercelAiGateway.inferenceRegion` can be matched to a model before a request fails.

## 0.5.25

### Patch Changes

- e7fae9c: Add the `vercelAiGateway.inferenceRegion` setting, which pins chat inference, and any data the provider stores, to the US, the EU, Australia or Japan. A pinned region can cost more, and a model with no provider there fails instead of running elsewhere. It is read from user settings only.
- ee54f97: When `vercelAiGateway.inferenceRegion` pins a region and the gateway rejects a chat request as invalid (HTTP 400), the chat error now says the model may have no provider in that region and that the setting can be set to `global` or another region.

## 0.5.24

### Patch Changes

- 7e60418: Add the `vercelAiGateway.fallbackModels` setting, a list of models AI Gateway tries in order when every provider of the chosen chat model fails. The answer is then billed at the fallback model's price. It is read from user settings only.
- 24652d8: Add the `vercelAiGateway.reportingTags` setting, a list of tags recorded with each chat request in AI Gateway's usage reports. The gateway bills each tag as a reporting write. It is read from user settings only.

## 0.5.23

### Patch Changes

- f4cf6e0: Add the `vercelAiGateway.providerOnly` setting, a list of provider slugs chat requests are restricted to, with no fallback to other providers. It is read from user settings only.

## 0.5.22

### Patch Changes

- a4b59b7: Add the `vercelAiGateway.providerOrder` setting, a list of provider slugs the gateway tries first for a chat model before falling back to the others.

## 0.5.21

### Patch Changes

- cb71892: Add the `vercelAiGateway.providerSort` setting, which asks the gateway to try a model's providers cheapest first (`cost`), lowest latency first (`ttft`) or highest throughput first (`tps`).

## 0.5.20

### Patch Changes

- c583813: Add the `vercelAiGateway.zeroDataRetention` setting, which routes chat requests only to providers with zero data retention agreements with Vercel.

## 0.5.19

### Patch Changes

- e012292: Add the `vercelAiGateway.disallowPromptTraining` setting, which routes chat requests only to providers that do not train on prompts, and explain the error when a model has no such provider.
- 6748292: Show in the model tooltip whether the providers serving a model may train on prompts or offer zero data retention.

## 0.5.18

### Patch Changes

- d9d9956: Show an icon for Vercel AI Gateway in the chat model picker (VS Code 1.143 and later).

## 0.5.17

### Patch Changes

- fac7a6d: Keep a chat working when a tool call in its history has no result: the call now gets a placeholder result instead of failing every later request with "Tool result is missing for tool call".

## 0.5.16

### Patch Changes

- ba430de: Check a new API key with the gateway before saving it. A key the gateway rejects is no longer stored as a session that fails every chat request; adding it shows that the gateway rejected the key instead. Spaces copied around the key are dropped, so a key pasted with a leading space is accepted. When the gateway cannot be reached the key is still saved.

## 0.5.15

### Patch Changes

- 5ecc9c1: The model picker tooltip now shows the model's knowledge cutoff when the gateway lists one.

## 0.5.14

### Patch Changes

- bd05bff: Say when the model provider ends an answer with an error, such as Gemini's malformed function call, instead of reporting no response or ending a partial answer silently.

## 0.5.13

### Patch Changes

- e3704bd: Accept a `vercelAiGateway.endpoint` setting copied from Vercel's docs with its API version, such as `https://ai-gateway.vercel.sh/v1` (the OpenAI SDK base URL) or `https://ai-gateway.vercel.sh/v4/ai` (the AI SDK one). The extension adds its own `/v1/models` and `/v1/ai` paths, so those values used to request paths like `/v1/v1/models` and got a 404; a trailing `/v<number>` or `/v<number>/ai` is now dropped.

## 0.5.12

### Patch Changes

- 15f8803: A timeout that fires in a pause after part of the answer has streamed now says the answer above is incomplete, instead of claiming the model sent no output.

## 0.5.11

### Patch Changes

- ab5972b: Send an SVG attachment or tool result as its text and replace other image types the model providers reject, such as BMP or TIFF, with a placeholder, so one such image no longer fails the whole request.

## 0.5.10

### Patch Changes

- d49e914: A chat request the gateway or the model provider rejects as invalid (HTTP 400) now names the status and shows the gateway's message once, instead of following it with the raw JSON error body. When the prompt is too long for the model, the error suggests starting a new chat or attaching less.
- 64a6c81: A tool whose input schema is empty or leaves out `"type": "object"` or `properties` is now sent to the gateway as an object schema, so one such tool no longer fails every chat request that offers it.

## 0.5.9

### Patch Changes

- abf4839: A chat request the gateway refuses because a spend budget is used up (HTTP 402) now says so, and that requests stay refused until the budget resets or is raised, instead of showing only the gateway's message.
- ef69224: The log now records each chat request's token usage, cached prompt tokens included, and the gateway's generation id, the id the gateway looks a request up by.
- caa0e77: Check Connection now reports how many of the listed models are chat models the model picker offers, instead of a total that also counted embedding, image and video models.
- 4d675c6: Check Connection now shows the team's AI Gateway credit balance and total used when the gateway returns them, so a run of failing requests can be checked against an empty balance.
- 54daf32: The model picker tooltip now shows the gateway's input and output prices per million tokens, marked "from" for models priced by prompt size.

## 0.5.8

### Patch Changes

- bff037e: Ask the gateway to cache the prompt when VS Code marks cache breakpoints in a chat request. The breakpoints used to be dropped with nothing in their place, so models that cache only where told, such as Anthropic's, reprocessed the whole conversation at full input price on every turn of an agent session.

## 0.5.7

### Patch Changes

- 3c24b84: Use the default gateway when the `vercelAiGateway.endpoint` setting is empty. Clearing the field in the Settings editor saves an empty value, which made every model list and chat request fail with an invalid URL; a value that is not text in `settings.json` made them fail outright. Both now fall back to `https://ai-gateway.vercel.sh`.
- 25dd560: Say how to sign in when a chat request has no session. The chat used to answer "Vercel AI Gateway API key not found", which named no next step and mentioned only API keys; it now points to Manage Authentication and both sign-in methods.
- 7af4e58: Say when the gateway could not be reached. A chat request that got no response, because the endpoint did not resolve, refused the connection or timed out connecting, used to be reported as "HTTP 500" with "Invalid error response format", or with advice to raise a Node.js timeout; it now says no response came back and points to the network connection and the `vercelAiGateway.endpoint` setting.

## 0.5.6

### Patch Changes

- eff797f: Keep a requested output limit within the model's own. An extension that asks for more output tokens than the model allows now gets the model's limit, and one that sends a limit that is not a whole positive number gets the model's limit instead of an error.
- 93aafcc: Stop showing setup steps that do not apply when the gateway rejects the credentials. The chat error used to repeat the AI SDK's advice to pass an `apiKey` option or set `AI_GATEWAY_API_KEY`, neither of which the extension reads; it now keeps the gateway's reason and points to Manage Authentication.
- eceffde: Say how long to wait when the gateway rate limits a chat request. When the gateway's reply carries a `Retry-After` header, the error in the chat now names the wait instead of only saying to wait a moment.

## 0.5.5

### Patch Changes

- eb316bd: Keep the `vercelAiGateway.timeout` setting inside its 5000 to 300000 ms range. VS Code accepts any value typed into `settings.json` and only underlines it, so a value of `0` made every model list request time out immediately and a quoted number broke Check Connection. A number outside the range is now clamped to it, and anything that is not a number uses the 30000 ms default.
- 2cc1385: Mark models the gateway lists as deprecated. The model picker showed them like any other model, so a chat could keep using one until the gateway stopped serving it; the picker now shows the deprecation date next to the model and in its tooltip.
- 38f7604: Stop telling you to sign in again when a gateway rule refuses a chat request. A 403 from a routing or policy rule was reported as rejected credentials with a pointer to Manage Authentication; the chat now says a gateway rule refused the request, names the rule when the gateway sends one, and suggests checking the team's AI Gateway rules or picking another model.

## 0.5.4

### Patch Changes

- f5693b8: Say when the model provider's content filter stopped an answer. A filtered request used to show "No response received from model.", and a filtered partial answer ended with no explanation; both now end with a note that the content filter stopped it.
- fc0fee0: Leave room for the answer in each model's context window. The input limit VS Code sees is now the context window minus the output limit, and the output limit is at most half the window, so a long conversation no longer asks the model for more tokens than it has.
- 3d976e2: Stop sending a reasoning model's earlier thinking back to it as part of its answer. In agent mode, the Copilot Chat extension returns the thinking from earlier steps of the same request, and it reached the model as ordinary assistant text, so the model saw its own reasoning as something it had said and every step paid for those tokens again. Thinking parts are now left out of the request and out of the token estimate.
- 33299e3: Stop sending a temperature to models that take none. Chat features and other extensions can ask for a temperature without knowing the model, and the gateway marks some models, such as OpenAI's reasoning models, as not accepting one. The temperature is now left out of requests to those models.
- 3c5c068: Refresh the model list as soon as the `vercelAiGateway.endpoint` setting changes, instead of showing the previous endpoint's models for up to five minutes.
- 827dcba: Hand a malformed tool call back to VS Code instead of ending the answer with an error. When a model called a tool that does not exist or sent tool input that is not valid JSON, the chat showed an error next to a tool call carrying the raw text as its input; the call now reaches VS Code with an object input so the agent can answer it and the model can retry.
- 5c2fd21: List the web pages a search model cites under its answer. Models such as Perplexity's Sonar number their citations in the text but send the pages separately, and those pages used to be dropped, leaving `[1]` and `[2]` with nothing to point to.
- 5c3e048: Refresh the model list when the gateway says it no longer serves the chosen model. The model stayed in the picker for up to five minutes and the chat showed only the gateway's "Model not found"; the chat now says to pick another model and the list reloads.
- 2d301ee: Stop sending VS Code's prompt cache markers to the model as text. A cache breakpoint on a chat message used to reach the model as the word "ephemeral" appended to that message; it is now dropped, and a binary attachment the extension cannot convert is sent as a short placeholder instead of undecodable bytes.

## 0.5.3

### Patch Changes

- 3668204: Tag and create the GitHub release after each publish.

## 0.5.2

### Patch Changes

- 9ecad2f: Dismissing the sign-in picker no longer shows an error when VS Code starts the sign-in.

## 0.5.1

### Patch Changes

- 5f4959e: Ship `CHANGELOG.md` inside the installed extension, so the Marketplace page shows the changelog.

## 0.5.0

### Minor Changes

- f3783a5: Add **Vercel AI Gateway: Check Connection**, which tests the active session against the gateway and reports the endpoint, session, HTTP status, latency and model count, and **Vercel AI Gateway: Show Logs**, which opens the extension's log.

### Patch Changes

- 279c7d6: Treat closing a sign-in prompt as a cancellation. Dismissing the method, name, API key, team or project picker no longer shows an error such as "Failed to add session: Team selection cancelled"; real failures still do.
- d73403f: Stop showing an authentication error when you dismiss a picker or prompt while adding a session from the chat model sign-in. Real sign-in failures still show the error.
- cfd0b90: Tell you what to do when a chat request fails: rejected credentials point to "Vercel AI Gateway: Manage Authentication", a rate limit says to wait, and a gateway or provider failure says it is usually temporary. The output log now records the model, HTTP status, URL, retryability and elapsed time of each failed request.
- 4aa0fdb: Stop long chat responses from being cut off after 30 seconds. The timeout setting now limits how long the model may stay silent, and a timeout is reported as an error instead of ending the answer quietly.
- 260fdc5: Accept an endpoint setting with a trailing slash when listing models.
- 1b842e9: Read `vercelAiGateway.endpoint` from user settings only. A workspace `.vscode/settings.json` could point it at another server, and requests to the endpoint carry your API key or OIDC token. The setting is now machine scoped, so it is no longer synced between machines.
- 215284f: Show the underlying cause of network errors, such as `connect ECONNREFUSED` or a certificate failure, instead of only "fetch failed".
- fd70f91: Show the right models right after switching accounts. A model list still loading for the previous account no longer replaces the new account's list for the next five minutes.
- b265815: Explain why the model picker is empty. When the model list cannot be loaded, an error now names the gateway URL and the gateway's reason, with a button to open the logs and, for a rejected key, one to manage authentication. Background refreshes stay quiet.
- 28a0c5d: Keep the model picker usable when the gateway is slow or briefly unreachable. Loading the model list now gives up after the `timeout` setting instead of waiting forever, and a failed refresh keeps showing the last list that loaded instead of an empty picker.
- 80f9cf0: Format the "No response received from model." message with the same bold `Error:` prefix as every other error.
- 91a6221: List every team and project in the Vercel sign-in picker instead of only the first 20, and show the HTTP status when loading them fails.
- 2ccb35b: Stop showing an authentication error when you cancel the Vercel AI Gateway sign-in prompt. Real sign-in failures still show the error.
- f269c7b: Stop capping answers at 4096 tokens and forcing temperature 0.7. Requests now use each model's own output limit and default temperature, and an answer that hits the output limit says so.
- ac04a7f: Keep valid sessions when one stored entry is malformed, instead of deleting every saved API key and Vercel sign-in.
- 5d14640: Stop a session added or removed while an OIDC token refreshes from being lost or brought back, and refresh each token once when several callers ask for it at the same time.
- aeff613: Count attached images and a small per message overhead when estimating a message's tokens, so prompts with screenshots no longer overflow the model's context window.
- 7321f2e: Count tool calls, tool results and textual attachments when estimating a message's tokens, so VS Code no longer treats a long agent conversation as far smaller than it is.
- 998230c: Stop follow-up requests failing after tools that return JSON or images, or after several tools run in parallel. Every tool call now gets its result, and parallel calls are sent together in the shape providers expect.
- 5fe6760: Tell the user, once, when stored sessions cannot be read and have to be added again, with a shortcut to Manage Authentication, and log why without logging the stored content.
- 7177eaf: Stop a stalled connection to Vercel from hanging chat or the OIDC sign-in pickers. Loading teams and projects and refreshing an OIDC token now give up after 15 seconds with "Timed out contacting Vercel", and the next request tries again.
- a583214: Offer Vercel OIDC sign-in on Windows and on platforms other than macOS and Linux by reading the Vercel CLI login from the same folder the CLI writes it to, and ignore an `auth.json` whose token is not a string.
- d7536f1: Stop shipping the repository's contributor notes (`CLAUDE.md` and `brain/`) inside the installed extension.

## 0.4.1

### Patch Changes

- f4792d4: Send the VS Code system prompt as instructions instead of a system message

  VS Code sends its instructions as assistant messages before the first user message. Those were
  rewritten to `system` role messages and left in the `messages` array, which the AI SDK rejects with
  "System messages are not allowed in the prompt or messages fields", breaking every chat request.
  They are now extracted and passed through the `instructions` option, leaving `messages` with only
  user, assistant and tool turns.

- cf4a7e0: Read the active session from our own authentication provider

  Probing for models silently found no credential and reported no models, even with a valid session
  stored. VS Code only hands a session back to a consumer once an access grant has been recorded, and
  sessions created through the provider interface never take that path, so `authentication.getSession`
  answered `undefined` in silent mode. The chat provider now reads the active session straight from
  the authentication provider this extension registers, and only falls back to
  `authentication.getSession` to start the sign-in flow when no session exists yet.

## 0.4.0

### Minor Changes

- 88b4297: Fix account switching, and declare the authentication provider

  - Each authentication session now gets its own account id. Every session previously shared one
    ("vercel-ai-user" for API keys, "vercel-oidc-user" for OIDC), so VS Code could not tell accounts
    apart and switching the active session did not reliably change which credential was used. The
    provider also now declares `supportsMultipleAccounts`, honours the requested account in
    `getSessions`, and the chat provider asks for the active account explicitly instead of relying on
    VS Code's remembered preference. Existing sessions are migrated automatically; because account
    identity changes, VS Code may ask you to pick an account once after updating.
  - Declare the `vercelAiGateway` authentication provider in the manifest, removing the "was not
    declared in the Extension Manifest" warning on activation.
  - Detect model capabilities (vision, tool calling, reasoning) from the structured fields the
    gateway returns, falling back to tag matching only when a field is absent.

## 0.3.0

### Minor Changes

- 53537b0: feat(vscode-ai-gateway): improved streaming and logging

  - Add structured logging using VS Code's native LogOutputChannel
  - Add proper stream chunk handling for text, reasoning, files, tool calls, and errors
  - Add model identity parsing for better family/version extraction
  - Add configurable endpoint and timeout settings
  - Improve message conversion with proper tool result mapping

### Patch Changes

- f92de45: fix(vscode-ai-gateway): refresh models after authentication

  Subscribe to authentication session changes so the model list is re-queried after the user signs in via "Manage Authentication". Previously the provider declared `onDidChangeLanguageModelChatInformation` but never fired it, leaving the Copilot Chat model picker empty until the window was reloaded.

## 0.2.2

### Patch Changes

- c513d19: Fix auth session bugs in VSCode extension

## 0.2.1

### Patch Changes

- da0f1aa: Update docs

## 0.2.0

### Minor Changes

- Migrated to SferaDev monorepo
- Updated repository URLs and package configuration
- Added VSCE release workflow with GitHub CI integration
