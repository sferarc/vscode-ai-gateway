export const EXTENSION_ID = "vercelAiGateway";
export const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh";
export const MODELS_ENDPOINT = "/v1/models";
export const MODELS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const TOKEN_REFRESH_MARGIN = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_TIMEOUT_MS = 30000;
export const MIN_TIMEOUT_MS = 5000;
export const MAX_TIMEOUT_MS = 300000;
export const VERCEL_API_TIMEOUT_MS = 15000;

export const ERROR_MESSAGES = {
	AUTH_FAILED: "Failed to authenticate with Vercel AI Gateway. Please try again.",
	NOT_SIGNED_IN:
		'Not signed in to Vercel AI Gateway. Run "Vercel AI Gateway: Manage Authentication" to add an API key or sign in with Vercel OIDC, then send the message again.',
	VERCEL_CLI_NOT_LOGGED_IN: "Vercel CLI not logged in. Please run `vercel login` first.",
	MODELS_FETCH_FAILED: "Failed to fetch models from Vercel AI Gateway",
} as const;
