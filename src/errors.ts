import {
	GatewayAuthenticationError,
	GatewayError,
	GatewayForbiddenError,
	GatewayModelNotFoundError,
} from "@ai-sdk/gateway";
import { APICallError, RetryError } from "ai";
import { EXTENSION_ID } from "./constants";
import { extractErrorMessage } from "./logger";

const MANAGE_AUTH_COMMAND = "Vercel AI Gateway: Manage Authentication";
const ENDPOINT_SETTING = `${EXTENSION_ID}.endpoint`;
const MAX_CAUSE_DEPTH = 3;

export interface GatewayErrorDescription {
	statusCode?: number;
	/** Request URL without credentials or query string. */
	url?: string;
	isRetryable?: boolean;
	/** The gateway does not serve the requested model, so the cached model list is out of date. */
	modelNotFound: boolean;
	userMessage: string;
}

export function describeGatewayError(error: unknown): GatewayErrorDescription {
	// streamText retries retryable failures and then throws a RetryError holding the last one.
	const failure = RetryError.isInstance(error) ? error.lastError : error;
	const apiCall = findApiCallError(failure);
	const gateway = GatewayError.isInstance(failure) ? failure : undefined;
	// A fetch that got no response still becomes a gateway error with a made up 500, or 408 on a connect timeout.
	const unreachable = apiCall !== undefined && apiCall.statusCode === undefined;
	const statusCode = unreachable ? undefined : (gateway?.statusCode ?? apiCall?.statusCode);
	const modelNotFound = GatewayModelNotFoundError.isInstance(failure);
	const detail = GatewayAuthenticationError.isInstance(failure)
		? authenticationDetail(failure, apiCall)
		: extractErrorMessage(error);
	return {
		statusCode,
		url: apiCall ? redactUrl(apiCall.url) : undefined,
		isRetryable: gateway?.isRetryable ?? apiCall?.isRetryable,
		modelNotFound,
		userMessage: unreachable
			? `Could not reach the gateway; no HTTP response came back. Check the network connection and the "${ENDPOINT_SETTING}" setting, then try again. Details: ${apiCall.message}`
			: modelNotFound
				? `The gateway does not offer this model (HTTP ${statusCode}). The model list is being refreshed; pick another model. Details: ${detail}`
				: GatewayForbiddenError.isInstance(failure)
					? policyMessage(statusCode, failure.ruleId, detail)
					: userMessageFor(statusCode, detail, retryAfterMs(apiCall)),
	};
}

// A forbidden error is a gateway rule refusing the request, so signing in again would not help.
function policyMessage(
	statusCode: number | undefined,
	ruleId: string | undefined,
	detail: string,
): string {
	const status = [`HTTP ${statusCode ?? "unknown"}`, ruleId ? `rule ${ruleId}` : undefined]
		.filter(Boolean)
		.join(", ");
	return `A gateway rule refused this request (${status}); the credentials are fine. Check the team's AI Gateway rules or pick another model. Details: ${detail}`;
}

// The SDK replaces the gateway's message with setup steps for its apiKey option and AI_GATEWAY_API_KEY, which this extension does not read.
function authenticationDetail(error: GatewayAuthenticationError, apiCall?: APICallError): string {
	const summary = error.message.split("\n", 1)[0]?.trim() ?? "";
	const gatewayMessage = apiCall?.message.trim();
	if (!gatewayMessage || gatewayMessage === summary) return summary;
	return summary ? `${summary} (${gatewayMessage})` : gatewayMessage;
}

// The gateway provider wraps the APICallError from the HTTP layer in a GatewayError's cause.
function findApiCallError(error: unknown): APICallError | undefined {
	let current = error;
	for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current != null; depth++) {
		if (APICallError.isInstance(current)) return current;
		current = current instanceof Error ? current.cause : undefined;
	}
	return undefined;
}

function redactUrl(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.username = "";
		parsed.password = "";
		parsed.search = "";
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return "(unparseable URL)";
	}
}

// Same headers, in the same order, that the AI SDK reads when it waits between retries.
function retryAfterMs(apiCall: APICallError | undefined): number | undefined {
	const headers = apiCall?.responseHeaders;
	if (!headers) return undefined;
	const ms = Number.parseFloat(headers["retry-after-ms"] ?? "");
	if (Number.isFinite(ms)) return ms > 0 ? ms : undefined;
	const retryAfter = headers["retry-after"]?.trim();
	if (!retryAfter) return undefined;
	const seconds = Number(retryAfter);
	const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
	return Number.isFinite(wait) && wait > 0 ? wait : undefined;
}

function formatWait(ms: number): string {
	const seconds = Math.ceil(ms / 1000);
	if (seconds < 120) return seconds === 1 ? "1 second" : `${seconds} seconds`;
	return `${Math.ceil(seconds / 60)} minutes`;
}

function userMessageFor(
	statusCode: number | undefined,
	detail: string,
	retryAfter: number | undefined,
): string {
	if (statusCode === 401 || statusCode === 403) {
		return `The gateway rejected the credentials (HTTP ${statusCode}). Run "${MANAGE_AUTH_COMMAND}" to sign in again or replace the API key. Details: ${detail}`;
	}
	if (statusCode === 429) {
		const wait = retryAfter
			? `It asks to wait ${formatWait(retryAfter)} before trying again.`
			: "Wait a moment and try again.";
		return `The gateway rate limited this request (HTTP 429). ${wait} Details: ${detail}`;
	}
	if (statusCode !== undefined && statusCode >= 500) {
		return `The gateway or the model provider failed (HTTP ${statusCode}). This is usually temporary, so try again. Details: ${detail}`;
	}
	return detail;
}

/** Name and message are "Canceled" so VS Code's isCancellationError ignores a dismissed prompt; `reason` holds the detail. */
export class AuthCancelledError extends Error {
	readonly reason: string;

	constructor(reason: string) {
		super("Canceled");
		this.name = "Canceled";
		this.reason = reason;
	}
}
