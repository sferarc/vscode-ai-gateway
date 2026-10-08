# Configuration

Two settings, declared in `package.json` `contributes.configuration` and read by `getConfig()` in `src/config.ts` on every call, so a change applies to the next request without a reload:

| Setting | Default | Used by |
| --- | --- | --- |
| `vercelAiGateway.endpoint` | `https://ai-gateway.vercel.sh` | model list (`{endpoint}/v1/models`) and chat (`{endpoint}/v1/ai`) |
| `vercelAiGateway.timeout` | `30000` ms, range 5000 to 300000 | the `timeout` passed to `streamText` |

The model list cache is not cleared when `endpoint` changes, so a new endpoint's models can take up to 5 minutes to appear (inferred from `src/models.ts`; no test covers it).

Constants that are not settings live in `src/constants.ts`: the models path, the 5 minute cache TTL, a 15 minute `TOKEN_REFRESH_MARGIN` (an OIDC token counts as expired that long before it expires, `isExpired` in `src/vercel-auth.ts`), and the user-facing error strings.
