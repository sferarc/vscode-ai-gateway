import {
	GatewayAuthenticationError,
	GatewayError,
	GatewayForbiddenError,
	GatewayInvalidRequestError,
	GatewayModelNotFoundError,
} from "@ai-sdk/gateway";
import { APICallError, RetryError } from "ai";
import { l10n } from "vscode";
import { EXTENSION_ID } from "./constants";
import { extractErrorMessage } from "./logger";

const ENDPOINT_SETTING = `${EXTENSION_ID}.endpoint`;
const PROMPT_TRAINING_SETTING = `${EXTENSION_ID}.disallowPromptTraining`;
const ZERO_DATA_RETENTION_SETTING = `${EXTENSION_ID}.zeroDataRetention`;
const PROVIDER_ONLY_SETTING = `${EXTENSION_ID}.providerOnly`;
const INFERENCE_REGION_SETTING = `${EXTENSION_ID}.inferenceRegion`;
const EXCLUDE_QUANTIZATIONS_SETTING = `${EXTENSION_ID}.excludeQuantizations`;
const REQUIRED_CAPABILITIES_SETTING = `${EXTENSION_ID}.requiredCapabilities`;
const MAX_CAUSE_DEPTH = 3;

export interface GatewayErrorDescription {
	statusCode?: number;
	/** Request URL without credentials or query string. */
	url?: string;
	isRetryable?: boolean;
	/** The gateway does not serve the requested model, so the cached model list is out of date. */
	modelNotFound: boolean;
	generationId?: string;
	userMessage: string;
}

export interface GatewayRequestOptions {
	/** Provider slugs the request was restricted to with the gateway's `only` option. */
	providerOnly?: readonly string[];
	/** Region the request pinned inference to with the gateway's `inferenceRegion` option. */
	inferenceRegion?: string;
	/** Weight formats the request excluded with the gateway's `has` option. */
	excludeQuantizations?: readonly string[];
	/** Capabilities the request required with the gateway's `has` option. */
	requiredCapabilities?: readonly string[];
}

export function describeGatewayError(
	error: unknown,
	request: GatewayRequestOptions = {},
): GatewayErrorDescription {
	// streamText retries retryable failures and then throws a RetryError holding the last one.
	const failure = RetryError.isInstance(error) ? error.lastError : error;
	const apiCall = findApiCallError(failure);
	const gateway = GatewayError.isInstance(failure) ? failure : undefined;
	// A fetch that got no response still becomes a gateway error with a made up 500, or 408 on a connect timeout.
	const unreachable = apiCall !== undefined && apiCall.statusCode === undefined;
	const statusCode = unreachable ? undefined : (gateway?.statusCode ?? apiCall?.statusCode);
	const modelNotFound = GatewayModelNotFoundError.isInstance(failure);
	const noProviders = statusCode === 400 ? noProvidersAvailable(apiCall) : undefined;
	// The gateway's body for a model with no provider in the pinned region is not documented, so any 400 names the setting.
	const regionHint =
		statusCode === 400 && request.inferenceRegion
			? ` ${regionMessage(request.inferenceRegion)}`
			: "";
	// A budget or invalid request message is the gateway's own text; the cause chain only repeats it as raw JSON.
	const ownMessage = statusCode === 402 || GatewayInvalidRequestError.isInstance(failure);
	const detail = GatewayAuthenticationError.isInstance(failure)
		? authenticationDetail(failure, apiCall)
		: ownMessage && gateway
			? gateway.message
			: extractErrorMessage(error);
	return {
		statusCode,
		url: apiCall ? redactUrl(apiCall.url) : undefined,
		isRetryable: gateway?.isRetryable ?? apiCall?.isRetryable,
		modelNotFound,
		generationId: gateway?.generationId,
		userMessage: unreachable
			? l10n.t(
					'Could not reach the gateway; no HTTP response came back. Check the network connection and the "{0}" setting, then try again. Details: {1}',
					ENDPOINT_SETTING,
					apiCall.message,
				)
			: modelNotFound
				? l10n.t(
						"The gateway does not offer this model (HTTP {0}). The model list is being refreshed; pick another model. Details: {1}",
						String(statusCode),
						detail,
					)
				: noProviders !== undefined
					? `${noProvidersMessage(request.providerOnly)}${regionHint}${quantizationHint(request.excludeQuantizations)}${capabilityHint(request.requiredCapabilities)} ${l10n.t("Details: {0}", noProviders || detail)}`
					: GatewayForbiddenError.isInstance(failure)
						? policyMessage(statusCode, failure.ruleId, detail)
						: userMessageFor(statusCode, detail, retryAfterMs(apiCall), regionHint),
	};
}

function noProvidersMessage(providerOnly: readonly string[] | undefined): string {
	if (!providerOnly?.length) {
		return l10n.t(
			'No provider of this model meets the request\'s data policy (HTTP 400). Pick another model, or turn off the "{0}" or "{1}" setting if it is on.',
			PROMPT_TRAINING_SETTING,
			ZERO_DATA_RETENTION_SETTING,
		);
	}
	return l10n.t(
		'No provider of this model is in the "{0}" setting ({1}) and meets the request\'s data policy (HTTP 400). Pick another model, add a provider that serves it to "{0}", or turn off the "{2}" or "{3}" setting if it is on.',
		PROVIDER_ONLY_SETTING,
		providerOnly.join(", "),
		PROMPT_TRAINING_SETTING,
		ZERO_DATA_RETENTION_SETTING,
	);
}

function quantizationHint(formats: readonly string[] | undefined): string {
	if (!formats?.length) return "";
	return ` ${l10n.t(
		'The "{0}" setting skips providers serving {1} weights, which may leave this model none; remove a format from it.',
		EXCLUDE_QUANTIZATIONS_SETTING,
		formats.join(", "),
	)}`;
}

function capabilityHint(capabilities: readonly string[] | undefined): string {
	if (!capabilities?.length) return "";
	return ` ${l10n.t(
		'The "{0}" setting keeps only providers with {1}, which may leave this model none; remove a capability from it.',
		REQUIRED_CAPABILITIES_SETTING,
		capabilities.join(", "),
	)}`;
}

function regionMessage(region: string): string {
	return l10n.t(
		'The "{0}" setting pins inference to the {1} region, and this model may have no provider there; set it to "global" or another region.',
		INFERENCE_REGION_SETTING,
		region,
	);
}

// A forbidden error is a gateway rule refusing the request, so signing in again would not help.
function policyMessage(
	statusCode: number | undefined,
	ruleId: string | undefined,
	detail: string,
): string {
	const status = statusCode === undefined ? l10n.t("unknown") : String(statusCode);
	if (ruleId) {
		return l10n.t(
			"A gateway rule refused this request (HTTP {0}, rule {1}); the credentials are fine. Check the team's AI Gateway rules or pick another model. Details: {2}",
			status,
			ruleId,
			detail,
		);
	}
	return l10n.t(
		"A gateway rule refused this request (HTTP {0}); the credentials are fine. Check the team's AI Gateway rules or pick another model. Details: {1}",
		status,
		detail,
	);
}

// The SDK replaces the gateway's message with setup steps for its apiKey option and AI_GATEWAY_API_KEY, which this extension does not read.
function authenticationDetail(error: GatewayAuthenticationError, apiCall?: APICallError): string {
	const summary = error.message.split("\n", 1)[0]?.trim() ?? "";
	const gatewayMessage = apiCall?.message.trim();
	if (!gatewayMessage || gatewayMessage === summary) return summary;
	return summary ? `${summary} (${gatewayMessage})` : gatewayMessage;
}

// Vercel documents this refusal as a flat { error, type } body, which the SDK cannot parse and replaces with its own text.
function noProvidersAvailable(apiCall: APICallError | undefined): string | undefined {
	const body = responseBody(apiCall);
	if (!isRecord(body)) return undefined;
	const nested = isRecord(body.error) ? body.error : undefined;
	if ((nested?.type ?? body.type) !== "no_providers_available") return undefined;
	const message = nested?.message ?? body.error;
	return typeof message === "string" ? message.trim() : "";
}

function responseBody(apiCall: APICallError | undefined): unknown {
	if (apiCall?.data !== undefined) return apiCall.data;
	if (!apiCall?.responseBody) return undefined;
	try {
		return JSON.parse(apiCall.responseBody);
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
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
	if (seconds < 120) return seconds === 1 ? l10n.t("1 second") : l10n.t("{0} seconds", seconds);
	return l10n.t("{0} minutes", Math.ceil(seconds / 60));
}

function userMessageFor(
	statusCode: number | undefined,
	detail: string,
	retryAfter: number | undefined,
	regionHint: string,
): string {
	if (statusCode === 400) {
		return `${l10n.t("The gateway or the model provider rejected the request as invalid (HTTP 400). If the details say the prompt is too long, start a new chat or attach less.")}${regionHint} ${l10n.t("Details: {0}", detail)}`;
	}
	if (statusCode === 401 || statusCode === 403) {
		return l10n.t(
			'The gateway rejected the credentials (HTTP {0}). Run "{1}" to sign in again or replace the API key. Details: {2}',
			statusCode,
			l10n.t("Vercel AI Gateway: Manage Authentication"),
			detail,
		);
	}
	if (statusCode === 402) {
		return l10n.t(
			"A gateway spend budget is used up (HTTP 402), so the gateway refuses requests until the budget resets or is raised. Ask whoever manages the team's AI Gateway budgets, or wait for the reset. Details: {0}",
			detail,
		);
	}
	if (statusCode === 429) {
		return retryAfter
			? l10n.t(
					"The gateway rate limited this request (HTTP 429). It asks to wait {0} before trying again. Details: {1}",
					formatWait(retryAfter),
					detail,
				)
			: l10n.t(
					"The gateway rate limited this request (HTTP 429). Wait a moment and try again. Details: {0}",
					detail,
				);
	}
	if (statusCode !== undefined && statusCode >= 500) {
		return l10n.t(
			"The gateway or the model provider failed (HTTP {0}). This is usually temporary, so try again. Details: {1}",
			statusCode,
			detail,
		);
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
