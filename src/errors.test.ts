import {
	GatewayAuthenticationError,
	GatewayInternalServerError,
	GatewayModelNotFoundError,
	GatewayRateLimitError,
} from "@ai-sdk/gateway";
import { APICallError, RetryError } from "ai";
import { describe, expect, it, vi } from "vitest";
import { describeGatewayError } from "./errors";

vi.mock("vscode", () => ({}));

function apiCallError(
	statusCode: number,
	url = "https://ai-gateway.vercel.sh/v1/ai/language-model",
) {
	return new APICallError({
		message: `HTTP ${statusCode}`,
		url,
		requestBodyValues: { prompt: "secret prompt" },
		statusCode,
	});
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
	});

	it.each([401, 403])("points to Manage Authentication on %i", (statusCode) => {
		const error = new GatewayAuthenticationError({ statusCode, cause: apiCallError(statusCode) });
		const { userMessage } = describeGatewayError(error);
		expect(userMessage).toContain(`rejected the credentials (HTTP ${statusCode})`);
		expect(userMessage).toContain('"Vercel AI Gateway: Manage Authentication"');
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
