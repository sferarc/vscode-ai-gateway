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
		pricing: {
			input: "0.000003",
			output: "0.000015",
			input_cache_read: "0.0000003",
			input_cache_write: "0.00000375",
		},
		modalities: { input: ["text", "image"] },
		supported_parameters: ["tools", "reasoning"],
	},
	{ id: "openai/unpriced", name: "Unpriced", type: "language", context_window: 0, max_tokens: 0 },
	{ id: "openai/text-embedding-3-small", name: "Embedding", type: "embedding" },
];

const REPORT = [
	{ model: "openai/gpt-5", total_cost: 0.75, request_count: 10 },
	{ model: "anthropic/claude-sonnet-4.5", total_cost: 2.5, request_count: 40 },
];

const SPEND_LINE =
	"Spend this month (since 2026-11-01 UTC): $3.25 over 50 requests. Most spent on: anthropic/claude-sonnet-4.5 $2.50, openai/gpt-5 $0.75.";

function routeFetch(options: {
	credits?: () => Promise<unknown>;
	models?: () => Promise<unknown>;
	report?: () => Promise<unknown>;
}) {
	const fetchMock = vi.fn(async (url?: unknown) => {
		if (String(url).endsWith("/v1/credits")) {
			return options.credits
				? options.credits()
				: { ok: true, status: 200, json: async () => ({ balance: "12.5", total_used: "3.25" }) };
		}
		if (String(url).includes("/v1/report?")) {
			return options.report
				? options.report()
				: { ok: true, status: 200, json: async () => ({ results: REPORT }) };
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
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
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
				SPEND_LINE,
				"- anthropic/claude-sonnet-4.5 (Claude Sonnet 4.5): $3.00 per million input tokens, $15.00 per million output tokens, $0.30 per million cache read tokens, $3.75 per million cache write tokens; context window 200000 tokens, up to 64000 output; supports tool calling, image input and reasoning.",
				"- openai/unpriced (Unpriced): input price not listed, output price not listed; context window not listed; no tool calling, image input or reasoning.",
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
			[
				"Credits: 12.5 left, 3.25 used.",
				SPEND_LINE,
				"Models: 2 chat models available. Pass search to find ids, or ids in modelIds, for prices and context windows.",
			].join("\n"),
		);
	});

	it("names each capability the model picker reports for a model", async () => {
		routeFetch({
			models: async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					data: [
						{ id: "a/tools", name: "Tools", type: "language", supported_parameters: ["tools"] },
						{
							id: "b/vision",
							name: "Vision",
							type: "language",
							modalities: { input: ["text", "image"] },
							supported_parameters: ["tool_choice"],
						},
					],
				}),
			}),
		});

		const text = await invoke({ accessToken: TOKEN }, { modelIds: ["a/tools", "b/vision"] });

		expect(text.split("\n").slice(2)).toEqual([
			"- a/tools (Tools): input price not listed, output price not listed; context window not listed; supports tool calling.",
			"- b/vision (Vision): input price not listed, output price not listed; context window not listed; supports tool calling and image input.",
		]);
	});

	it("caps the requested ids at the manifest's maxItems", async () => {
		routeFetch({});
		const ids = Array.from({ length: 25 }, (_, i) => `x/model-${i}`);

		const text = await invoke({ accessToken: TOKEN }, { modelIds: ids });

		expect(text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(20);
	});

	it("finds chat models by a search term in the id", async () => {
		routeFetch({});

		const text = await invoke({ accessToken: TOKEN }, { search: " ANTHROPIC/ " });

		expect(text).toBe(
			[
				"Credits: 12.5 left, 3.25 used.",
				SPEND_LINE,
				'Models matching "ANTHROPIC/": 1.',
				"- anthropic/claude-sonnet-4.5 (Claude Sonnet 4.5): $3.00 per million input tokens, $15.00 per million output tokens, $0.30 per million cache read tokens, $3.75 per million cache write tokens; context window 200000 tokens, up to 64000 output; supports tool calling, image input and reasoning.",
			].join("\n"),
		);
	});

	it("finds chat models by a search term in the name and leaves out other model types", async () => {
		routeFetch({});

		const byName = await invoke({ accessToken: TOKEN }, { search: "sonnet 4.5" });
		const embedding = await invoke({ accessToken: TOKEN }, { search: "embedding" });

		expect(byName).toContain("- anthropic/claude-sonnet-4.5 (Claude Sonnet 4.5):");
		expect(embedding.split("\n")[2]).toBe(
			'Models matching "embedding": none of the 2 chat models.',
		);
	});

	it("lists search matches before the requested ids", async () => {
		routeFetch({});

		const text = await invoke(
			{ accessToken: TOKEN },
			{ search: "unpriced", modelIds: ["anthropic/claude-sonnet-4.5"] },
		);

		expect(text.split("\n").slice(2)).toEqual([
			'Models matching "unpriced": 1.',
			"- openai/unpriced (Unpriced): input price not listed, output price not listed; context window not listed; no tool calling, image input or reasoning.",
			"- anthropic/claude-sonnet-4.5 (Claude Sonnet 4.5): $3.00 per million input tokens, $15.00 per million output tokens, $0.30 per million cache read tokens, $3.75 per million cache write tokens; context window 200000 tokens, up to 64000 output; supports tool calling, image input and reasoning.",
		]);
	});

	it("treats a blank or non string search as no search", async () => {
		routeFetch({});

		const blank = await invoke({ accessToken: TOKEN }, { search: "  " });
		const number = await invoke({ accessToken: TOKEN }, { search: 5 });

		expect(blank.split("\n")[2]).toMatch(/^Models: 2 chat models available\./);
		expect(number).toBe(blank);
	});

	it("caps search matches at the manifest's maxItems and says how many matched", async () => {
		const many = Array.from({ length: 25 }, (_, i) => ({
			id: `xai/grok-${i}`,
			name: `Grok ${i}`,
			type: "language",
		}));
		routeFetch({
			models: async () => ({ ok: true, status: 200, json: async () => ({ data: many }) }),
		});

		const text = await invoke({ accessToken: TOKEN }, { search: "grok" });
		const lines = text.split("\n");

		expect(lines[2]).toBe(
			'Models matching "grok": 25, showing the first 20. Use a longer search term to narrow them.',
		);
		expect(lines.filter((line) => line.startsWith("- "))).toHaveLength(20);
	});

	it("asks the gateway for this month's spend by model", async () => {
		const fetchMock = routeFetch({});

		await invoke({ accessToken: TOKEN }, {});

		expect(fetchMock).toHaveBeenCalledWith(
			`${DEFAULT_BASE_URL}/v1/report?start_date=2026-11-01&end_date=2026-11-05&group_by=model`,
			expect.objectContaining({ headers: { Authorization: `Bearer ${TOKEN}` } }),
		);
	});

	it("names the top three models by spend and skips rows without a cost", async () => {
		routeFetch({
			report: async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					results: [
						{ model: "a/one", total_cost: 0.0042 },
						{ model: "b/two", total_cost: 1 },
						{ model: "c/free", total_cost: 0 },
						{ model: "d/three", total_cost: 0.5 },
						{ model: "e/four", total_cost: 0.25 },
						{ model: "f/bad", total_cost: "7" },
						null,
					],
				}),
			}),
		});

		const text = await invoke({ accessToken: TOKEN }, {});

		expect(text.split("\n")[1]).toBe(
			"Spend this month (since 2026-11-01 UTC): $1.7542. Most spent on: b/two $1.00, d/three $0.50, e/four $0.25.",
		);
	});

	it("reports a month with no spend", async () => {
		routeFetch({
			report: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }),
		});

		const text = await invoke({ accessToken: TOKEN }, {});

		expect(text.split("\n")[1]).toBe("Spend this month (since 2026-11-01 UTC): $0.00.");
	});

	it("still answers when the spend report is refused or unreadable", async () => {
		routeFetch({ report: async () => ({ ok: false, status: 403, json: async () => ({}) }) });
		const refused = await invoke({ accessToken: TOKEN }, {});
		routeFetch({ report: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
		const malformed = await invoke({ accessToken: TOKEN }, {});
		routeFetch({ report: () => Promise.reject(new TypeError("fetch failed")) });
		const failed = await invoke({ accessToken: TOKEN }, {});

		for (const text of [refused, malformed, failed]) {
			expect(text.split("\n")).toEqual([
				"Credits: 12.5 left, 3.25 used.",
				"Spend this month: the gateway did not return a spend report for this session.",
				"Models: 2 chat models available. Pass search to find ids, or ids in modelIds, for prices and context windows.",
			]);
		}
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

		expect(text.split("\n")[2]).toBe(
			"Models: the gateway rejected the session's credentials. Ask the user to run Vercel AI Gateway: Manage Authentication to add an API key or sign in with Vercel OIDC.",
		);
	});

	it("points at Check Connection when the model list cannot be loaded", async () => {
		routeFetch({ models: () => Promise.reject(new TypeError("fetch failed")) });

		const text = await invoke({ accessToken: TOKEN }, {});

		expect(text.split("\n")[2]).toBe(
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
			"Reading Vercel AI Gateway credits, spend and model prices",
		);
	});
});
