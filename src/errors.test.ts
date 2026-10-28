import {
	createGatewayProvider,
	GatewayAuthenticationError,
	GatewayForbiddenError,
	GatewayInternalServerError,
	GatewayModelNotFoundError,
	GatewayRateLimitError,
} from "@ai-sdk/gateway";
import { APICallError, RetryError, streamText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeGatewayError } from "./errors";
import { extractErrorMessage } from "./logger";

vi.mock("vscode", () => ({}));

function apiCallError(
	statusCode: number,
	url = "https://ai-gateway.vercel.sh/v1/ai/language-model",
	responseHeaders?: Record<string, string>,
) {
	return new APICallError({
		message: `HTTP ${statusCode}`,
		url,
		requestBodyValues: { prompt: "secret prompt" },
		statusCode,
		responseHeaders,
	});
}

function rateLimited(responseHeaders: Record<string, string>) {
	const last = new GatewayRateLimitError({
		cause: apiCallError(429, undefined, responseHeaders),
	});
	return new RetryError({
		message: "Failed after 3 attempts",
		reason: "maxRetriesExceeded",
		errors: [last, last, last],
	});
}

// Runs a real gateway request whose fetch fails the way Node's does when no response arrives.
async function unreachableGatewayError(code: string, message: string): Promise<unknown> {
	const fetch = async () => {
		throw new TypeError("fetch failed", { cause: Object.assign(new Error(message), { code }) });
	};
	const gateway = createGatewayProvider({
		apiKey: "vck_test",
		baseURL: "https://gateway.example/v1/ai",
		fetch,
	});
	const result = streamText({ model: gateway("openai/gpt-5"), prompt: "hi", maxRetries: 0 });
	for await (const chunk of result.fullStream) {
		if (chunk.type === "error") return chunk.error;
	}
	throw new Error("The stream ended without an error part");
}

// Runs a real gateway request that the gateway answers with the given status and JSON body.
async function gatewayResponseError(status: number, body: unknown) {
	let requests = 0;
	const fetch = async () => {
		requests++;
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	};
	const gateway = createGatewayProvider({
		apiKey: "vck_test",
		baseURL: "https://gateway.example/v1/ai",
		fetch,
	});
	const result = streamText({ model: gateway("openai/gpt-5"), prompt: "hi" });
	for await (const chunk of result.fullStream) {
		if (chunk.type === "error") return { error: chunk.error, requests };
	}
	throw new Error("The stream ended without an error part");
}

describe("describeGatewayError", () => {
	it("reads status, url and retryability from an APICallError", () => {
		const description = describeGatewayError(apiCallError(400));
		expect(description).toMatchObject({
			statusCode: 400,
			url: "https://ai-gateway.vercel.sh/v1/ai/language-model",
			isRetryable: false,
		});
		expect(description.userMessage).toBe("HTTP 400");
	});

	it("finds the APICallError inside a gateway error", () => {
		const error = new GatewayInternalServerError({ statusCode: 502, cause: apiCallError(502) });
		expect(describeGatewayError(error)).toMatchObject({
			statusCode: 502,
			url: "https://ai-gateway.vercel.sh/v1/ai/language-model",
			isRetryable: true,
		});
	});

	it("reads the generation id a gateway error carries", () => {
		const error = new GatewayInternalServerError({ generationId: "gen_03ghi" });
		expect(describeGatewayError(error).generationId).toBe("gen_03ghi");
		expect(describeGatewayError(apiCallError(500)).generationId).toBeUndefined();
	});

	it("unwraps the last error after streamText gives up retrying", () => {
		const last = new GatewayRateLimitError({ cause: apiCallError(429) });
		const error = new RetryError({
			message: "Failed after 3 attempts",
			reason: "maxRetriesExceeded",
			errors: [last, last, last],
		});
		const description = describeGatewayError(error);
		expect(description.statusCode).toBe(429);
		expect(description.userMessage).toContain("rate limited");
		expect(description.userMessage).toContain("Wait a moment and try again.");
	});

	describe("rate limit wait", () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it.each<[Record<string, string>, string]>([
			[{ "retry-after": "30" }, "30 seconds"],
			[{ "retry-after": "1" }, "1 second"],
			[{ "retry-after": "0.2" }, "1 second"],
			[{ "retry-after-ms": "4500" }, "5 seconds"],
			[{ "retry-after-ms": "2000", "retry-after": "90" }, "2 seconds"],
			[{ "retry-after": "600" }, "10 minutes"],
		])("names the wait from %o", (headers, wait) => {
			const { userMessage } = describeGatewayError(rateLimited(headers));
			expect(userMessage).toContain(`(HTTP 429). It asks to wait ${wait} before trying again.`);
		});

		it("reads a Retry-After date", () => {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
			const headers = { "retry-after": "Tue, 27 Oct 2026 12:00:45 GMT" };
			const { userMessage } = describeGatewayError(rateLimited(headers));
			expect(userMessage).toContain("It asks to wait 45 seconds");
		});

		it.each<Record<string, string>>([
			{ "retry-after": "0" },
			{ "retry-after": "soon" },
			{ "retry-after": "Tue, 27 Oct 2020 12:00:45 GMT" },
			{ "retry-after-ms": "0" },
		])("falls back to a moment for %o", (headers) => {
			const { userMessage } = describeGatewayError(rateLimited(headers));
			expect(userMessage).toContain("(HTTP 429). Wait a moment and try again.");
		});
	});

	it.each([401, 403])("points to Manage Authentication on %i", (statusCode) => {
		const error = new GatewayAuthenticationError({ statusCode, cause: apiCallError(statusCode) });
		const { userMessage } = describeGatewayError(error);
		expect(userMessage).toContain(`rejected the credentials (HTTP ${statusCode})`);
		expect(userMessage).toContain('"Vercel AI Gateway: Manage Authentication"');
	});

	it("leaves out the SDK's setup steps for its own API key option", () => {
		const cause = new APICallError({
			message: "Invalid API key",
			url: "https://ai-gateway.vercel.sh/v1/ai/language-model",
			requestBodyValues: {},
			statusCode: 401,
		});
		const error = GatewayAuthenticationError.createContextualError({
			apiKeyProvided: true,
			oidcTokenProvided: false,
			cause,
		});
		const { userMessage } = describeGatewayError(error);
		expect(userMessage).toBe(
			'The gateway rejected the credentials (HTTP 401). Run "Vercel AI Gateway: Manage Authentication" to sign in again or replace the API key. Details: AI Gateway authentication failed: Invalid API key or token. (Invalid API key)',
		);
		expect(userMessage).not.toContain("AI_GATEWAY_API_KEY");
	});

	it("keeps a credential error's own message when the gateway gave the same one", () => {
		const error = new GatewayAuthenticationError({ message: "HTTP 401", cause: apiCallError(401) });
		expect(describeGatewayError(error).userMessage).toMatch(/Details: HTTP 401$/);
	});

	it("blames a gateway rule, not the credentials, for a forbidden error", () => {
		const error = new GatewayForbiddenError({
			message: "Blocked by routing rule",
			ruleId: "rule_123",
			cause: apiCallError(403),
		});
		const { statusCode, userMessage } = describeGatewayError(error);
		expect(statusCode).toBe(403);
		expect(userMessage).toContain("A gateway rule refused this request (HTTP 403, rule rule_123)");
		expect(userMessage).toContain("Details: Blocked by routing rule");
		expect(userMessage).not.toContain("Manage Authentication");
	});

	it("leaves the rule out of a forbidden error that names none", () => {
		const { userMessage } = describeGatewayError(new GatewayForbiddenError({ message: "Blocked" }));
		expect(userMessage).toContain("refused this request (HTTP 403);");
	});

	it("names a used up spend budget instead of passing the bare message through", async () => {
		// Budget rejection body from the "When a budget is exceeded" section of Vercel's AI Gateway budgets docs.
		const message =
			"Project budget exceeded. Current spend: $200.00, limit: $200.00. Please contact your administrator to increase the budget.";
		const { error, requests } = await gatewayResponseError(402, {
			error: { message, type: "quota_for_entity_exceeded" },
		});
		expect(GatewayInternalServerError.isInstance(error)).toBe(true);
		expect(requests).toBe(1);
		const description = describeGatewayError(error);
		expect(description).toMatchObject({ statusCode: 402, isRetryable: false });
		expect(description.userMessage).toBe(
			`A gateway spend budget is used up (HTTP 402), so the gateway refuses requests until the budget resets or is raised. Ask whoever manages the team's AI Gateway budgets, or wait for the reset. Details: ${message}`,
		);
		expect(description.userMessage).not.toContain("Manage Authentication");
	});

	it("calls a 5xx retryable", () => {
		const { userMessage } = describeGatewayError(apiCallError(503));
		expect(userMessage).toContain("(HTTP 503)");
		expect(userMessage).toContain("try again");
	});

	it("flags a model the gateway does not serve", () => {
		const error = new GatewayModelNotFoundError({
			message: "Model 'openai/gone' not found",
			modelId: "openai/gone",
			cause: apiCallError(404),
		});
		const description = describeGatewayError(error);
		expect(description).toMatchObject({ statusCode: 404, modelNotFound: true });
		expect(description.userMessage).toContain("does not offer this model (HTTP 404)");
		expect(description.userMessage).toContain("Details: Model 'openai/gone' not found");
	});

	it("does not flag other 404s as a missing model", () => {
		expect(describeGatewayError(apiCallError(404)).modelNotFound).toBe(false);
	});

	it("drops credentials and the query string from the url", () => {
		const error = apiCallError(500, "https://user:pass@example.com/v1/ai/language-model?key=abc");
		expect(describeGatewayError(error).url).toBe("https://example.com/v1/ai/language-model");
	});

	describe("unreachable gateway", () => {
		it.each([
			["ENOTFOUND", "getaddrinfo ENOTFOUND gateway.example"],
			["ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:443"],
			["UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error (timeout: 10000ms)"],
		])("reports %s as a network failure, not an HTTP status", async (code, message) => {
			const description = describeGatewayError(await unreachableGatewayError(code, message));
			expect(description).toMatchObject({
				statusCode: undefined,
				url: "https://gateway.example/v1/ai/language-model",
				isRetryable: true,
			});
			expect(description.userMessage).toBe(
				`Could not reach the gateway; no HTTP response came back. Check the network connection and the "vercelAiGateway.endpoint" setting, then try again. Details: Cannot connect to API: ${message}`,
			);
		});

		it("drops the SDK's advice to raise a Node.js timeout", async () => {
			const error = await unreachableGatewayError(
				"UND_ERR_CONNECT_TIMEOUT",
				"Connect Timeout Error",
			);
			expect(extractErrorMessage(error)).toContain("video-generation");
			expect(describeGatewayError(error).userMessage).not.toContain("video-generation");
		});
	});

	it("keeps the plain message for errors without a status", () => {
		expect(describeGatewayError(new Error("boom"))).toEqual({
			statusCode: undefined,
			url: undefined,
			isRetryable: undefined,
			modelNotFound: false,
			userMessage: "boom",
		});
	});
});
