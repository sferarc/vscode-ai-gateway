import { GatewayError } from "@ai-sdk/gateway";
import { APICallError, RetryError } from "ai";
import { extractErrorMessage } from "./logger";

const MANAGE_AUTH_COMMAND = "Vercel AI Gateway: Manage Authentication";
const MAX_CAUSE_DEPTH = 3;

export interface GatewayErrorDescription {
	statusCode?: number;
	/** Request URL without credentials or query string. */
	url?: string;
	isRetryable?: boolean;
	userMessage: string;
}

export function describeGatewayError(error: unknown): GatewayErrorDescription {
	// streamText retries retryable failures and then throws a RetryError holding the last one.
	const failure = RetryError.isInstance(error) ? error.lastError : error;
	const apiCall = findApiCallError(failure);
	const gateway = GatewayError.isInstance(failure) ? failure : undefined;
	const statusCode = gateway?.statusCode ?? apiCall?.statusCode;
	return {
		statusCode,
		url: apiCall ? redactUrl(apiCall.url) : undefined,
		isRetryable: gateway?.isRetryable ?? apiCall?.isRetryable,
		userMessage: userMessageFor(statusCode, extractErrorMessage(error)),
	};
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

function userMessageFor(statusCode: number | undefined, detail: string): string {
	if (statusCode === 401 || statusCode === 403) {
		return `The gateway rejected the credentials (HTTP ${statusCode}). Run "${MANAGE_AUTH_COMMAND}" to sign in again or replace the API key. Details: ${detail}`;
	}
	if (statusCode === 429) {
		return `The gateway rate limited this request (HTTP 429). Wait a moment and try again. Details: ${detail}`;
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
