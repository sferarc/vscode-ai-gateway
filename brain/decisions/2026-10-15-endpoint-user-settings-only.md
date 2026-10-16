# Gateway endpoint read from user settings only

Recorded 2026-10-16, from #36 (`1b842e9`).

## Decision

`vercelAiGateway.endpoint` is declared `"scope": "machine"` in `package.json`, and `getConfig()` in `src/config.ts` reads `config.inspect("endpoint")?.globalValue`, falling back to the default. A value in a workspace `.vscode/settings.json` or a folder setting is never used. `timeout` is still read with `config.get` and can come from any scope.

## Why

Every model list and chat request sends the stored API key or OIDC token to the endpoint. If a workspace could set it, opening and trusting a cloned repository would be enough to send the credential to whatever URL that repository named (#36 description).

## Guard

`getConfig endpoint` in `src/config.test.ts`: workspace and folder values are ignored, the user's value wins over a workspace override, and the manifest keeps the `machine` scope. Going back to `config.get("endpoint", ...)`, or dropping the scope, would let a workspace value reach the endpoint again.

See [[architecture/configuration]].
