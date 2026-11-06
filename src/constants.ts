export const EXTENSION_ID = "vercelAiGateway";
/** True while a session exists; the walkthrough's sign-in step completes on it. */
export const SIGNED_IN_CONTEXT_KEY = `${EXTENSION_ID}.signedIn`;
/** The `languageModelTools` name of the read-only credits and prices tool. */
export const STATUS_TOOL_NAME = `${EXTENSION_ID}_status`;
export const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh";
export const MODELS_ENDPOINT = "/v1/models";
export const MODELS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const TOKEN_REFRESH_MARGIN = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_TIMEOUT_MS = 30000;
export const MIN_TIMEOUT_MS = 5000;
export const MAX_TIMEOUT_MS = 300000;
export const VERCEL_API_TIMEOUT_MS = 15000;
