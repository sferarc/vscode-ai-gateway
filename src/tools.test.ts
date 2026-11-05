import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));

vi.mock("vscode", () => ({
	workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn((_, d) => d), inspect: vi.fn() })) },
	LanguageModelTextPart: class {
		constructor(readonly value: string) {}
	},
	LanguageModelToolResult: class {
		constructor(readonly content: unknown[]) {}
	},
}));

vi.mock("./logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("./logger")>()),
	logger: { info: vi.fn(), error: logError, warn: vi.fn(), debug: vi.fn(), show: vi.fn() },
}));

import type * as vscode from "vscode";
import { DEFAULT_BASE_URL } from "./constants";
import { ModelsClient } from "./models";
import { StatusTool, type StatusToolInput } from "./tools";

const TOKEN = "vck_secret_token_value";

const MODELS = [
	{
		id: "anthropic/claude-sonnet-4.5",
		name: "Claude Sonnet 4.5",
		type: "language",
		context_window: 200000,
		max_tokens: 64000,
		pricing: { input: "0.000003", output: "0.000015" },
	},
	{ id: "openai/unpriced", name: "Unpriced", type: "language", context_window: 0, max_tokens: 0 },
	{ id: "openai/text-embedding-3-small", name: "Embedding", type: "embedding" },
];

function routeFetch(options: {
	credits?: () => Promise<unknown>;
	models?: () => Promise<unknown>;
}) {
	const fetchMock = vi.fn(async (url?: unknown) => {
		if (String(url).endsWith("/v1/credits")) {
			return options.credits
				? options.credits()
				: { ok: true, status: 200, json: async () => ({ balance: "12.5", total_used: "3.25" }) };
		}
		return options.models
			? options.models()
			: { ok: true, status: 200, json: async () => ({ data: MODELS }) };
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

async function invoke(
	session: { accessToken: string } | null | Error,
	input: StatusToolInput,
): Promise<string> {
	const getSession = () =>
		session instanceof Error ? Promise.reject(session) : Promise.resolve(session);
	const tool = new StatusTool(getSession, new ModelsClient());
	const result = await tool.invoke({
		input,
		toolInvocationToken: undefined,
	} as vscode.LanguageModelToolInvocationOptions<StatusToolInput>);
	const parts = result.content as { value: string }[];
	expect(parts).toHaveLength(1);
	return parts[0]?.value ?? "";
}

describe("StatusTool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns the credit balance and the prices of the requested models", async () => {
		const fetchMock = routeFetch({});

		const text = await invoke(
			{ accessToken: TOKEN },
			{
				modelIds: [
					"anthropic/claude-sonnet-4.5",
					" openai/unpriced ",
					"anthropic/claude-sonnet-4.5",
					"nope/x",
				],
			},
		);

		expect(text).toBe(
			[
				"Credits: 12.5 left, 3.25 used.",
				"- anthropic/claude-sonnet-4.5 (Claude Sonnet 4.5): $3.00 per million input tokens, $15.00 per million output tokens; context window 200000 tokens, up to 64000 output.",
				"- openai/unpriced (Unpriced): input price not listed, output price not listed; context window not listed.",
				"- nope/x: not in the gateway's chat model list.",
			].join("\n"),
		);
		expect(fetchMock).toHaveBeenCalledWith(
			`${DEFAULT_BASE_URL}/v1/credits`,
			expect.objectContaining({ headers: { Authorization: `Bearer ${TOKEN}` } }),
		);
	});

	it("counts the chat models when no ids are passed and ignores ids that are not strings", async () => {
		routeFetch({});

		const text = await invoke({ accessToken: TOKEN }, { modelIds: [42, ""] });

		expect(text).toBe(
			"Credits: 12.5 left, 3.25 used.\nModels: 2 chat models available. Pass their ids in modelIds for prices and context windows.",
		);
	});

	it("caps the requested ids at the manifest's maxItems", async () => {
		routeFetch({});
		const ids = Array.from({ length: 25 }, (_, i) => `x/model-${i}`);

		const text = await invoke({ accessToken: TOKEN }, { modelIds: ids });

		expect(text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(20);
	});

	it("tells the model to have the user sign in when there is no session", async () => {
		const fetchMock = routeFetch({});

		const text = await invoke(null, { modelIds: ["anthropic/claude-sonnet-4.5"] });

		expect(text).toBe(
			"Not signed in to Vercel AI Gateway. Ask the user to run Vercel AI Gateway: Manage Authentication to add an API key or sign in with Vercel OIDC.",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("reports a session that cannot be read without failing the call", async () => {
		const text = await invoke(new Error("keychain locked"), {});

		expect(text).toContain("Could not read the Vercel AI Gateway session: keychain locked.");
		expect(text).toContain("Manage Authentication");
	});

	it("still lists prices when the balance is not available", async () => {
		routeFetch({ credits: async () => ({ ok: false, status: 404, json: async () => ({}) }) });

		const text = await invoke(
			{ accessToken: TOKEN },
			{ modelIds: ["anthropic/claude-sonnet-4.5"] },
		);

		expect(text.split("\n")[0]).toBe(
			"Credits: the gateway did not return a balance. Ask the user to run Vercel AI Gateway: Check Connection to see why.",
		);
		expect(text).toContain("$3.00 per million input tokens");
	});

	it("asks for a new sign in when the gateway rejects the credentials", async () => {
		routeFetch({
			credits: async () => ({ ok: false, status: 401, json: async () => ({}) }),
			models: async () => ({
				ok: false,
				status: 401,
				statusText: "Unauthorized",
				text: async () => "",
			}),
		});

		const text = await invoke(
			{ accessToken: TOKEN },
			{ modelIds: ["anthropic/claude-sonnet-4.5"] },
		);

		expect(text.split("\n")[1]).toBe(
			"Models: the gateway rejected the session's credentials. Ask the user to run Vercel AI Gateway: Manage Authentication to add an API key or sign in with Vercel OIDC.",
		);
	});

	it("points at Check Connection when the model list cannot be loaded", async () => {
		routeFetch({ models: () => Promise.reject(new TypeError("fetch failed")) });

		const text = await invoke({ accessToken: TOKEN }, {});

		expect(text.split("\n")[1]).toBe(
			"Models: the model list could not be loaded. Ask the user to run Vercel AI Gateway: Check Connection to see why.",
		);
	});

	it("never puts the token in the result or the log", async () => {
		routeFetch({ models: () => Promise.reject(new TypeError("fetch failed")) });

		const text = await invoke({ accessToken: TOKEN }, {});

		expect(text).not.toContain(TOKEN);
		expect(JSON.stringify(logError.mock.calls)).not.toContain(TOKEN);
	});

	it("names what it reads while it runs", () => {
		const tool = new StatusTool(async () => null, new ModelsClient());

		expect(tool.prepareInvocation().invocationMessage).toBe(
			"Reading Vercel AI Gateway credits and model prices",
		);
	});
});
