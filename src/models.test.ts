import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getConfiguration = vi.hoisted(() =>
	vi.fn(() => ({ get: vi.fn((_: string, d: unknown) => d), inspect: vi.fn() })),
);

vi.mock("vscode", () => ({
	workspace: { getConfiguration },
	EventEmitter: class {
		event = vi.fn();
		fire = vi.fn();
		dispose = vi.fn();
	},
}));

import { MODELS_CACHE_TTL_MS } from "./constants";
import { type Model, ModelsClient, ModelsFetchError } from "./models";

describe("ModelsClient", () => {
	let originalFetch: typeof fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("requests {endpoint}/v1/models when the endpoint setting ends with a slash", async () => {
		getConfiguration.mockReturnValueOnce({
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn(() => ({ globalValue: "https://gateway.example.com//" })),
		});
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await new ModelsClient().getModels("test-key");

		expect(fetchMock.mock.calls[0][0]).toBe("https://gateway.example.com/v1/models");
	});

	it("parses models with correct family, version, and capabilities", async () => {
		const models: Model[] = [
			{
				id: "openai:gpt-4o-2024-11-20",
				object: "model",
				created: 0,
				owned_by: "openai",
				name: "GPT-4o",
				description: "GPT-4o",
				context_window: 128000,
				max_tokens: 4096,
				type: "chat",
				tags: ["vision", "function_calling"],
				pricing: { input: "0", output: "0" },
			},
			{
				id: "openai:o3-mini",
				object: "model",
				created: 0,
				owned_by: "openai",
				name: "o3-mini",
				description: "Reasoning",
				context_window: 32768,
				max_tokens: 4096,
				type: "chat",
				tags: ["o3", "web-search"],
				pricing: { input: "0", output: "0" },
			},
		];

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ data: models }),
		}) as unknown as typeof fetch;

		const client = new ModelsClient();
		const result = await client.getModels("test-key");

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			family: "gpt-4o",
			version: "2024-11-20",
			maxInputTokens: 128000,
		});
		expect(result[0]?.capabilities).toMatchObject({ imageInput: true, toolCalling: true });
		expect(result[1]?.capabilities).toMatchObject({ reasoning: true, webSearch: true });
	});

	it("filters out non-chat models, keeps undefined type", async () => {
		const models: Model[] = [
			{
				id: "a:chat",
				object: "model",
				created: 0,
				owned_by: "a",
				name: "Chat",
				description: "",
				context_window: 1000,
				max_tokens: 100,
				type: "chat",
				tags: [],
				pricing: { input: "0", output: "0" },
			},
			{
				id: "b:embed",
				object: "model",
				created: 0,
				owned_by: "b",
				name: "Embed",
				description: "",
				context_window: 1000,
				max_tokens: 100,
				type: "embedding",
				tags: [],
				pricing: { input: "0", output: "0" },
			},
			{
				id: "c:undef",
				object: "model",
				created: 0,
				owned_by: "c",
				name: "Undef",
				description: "",
				context_window: 1000,
				max_tokens: 100,
				type: undefined as unknown as string,
				tags: [],
				pricing: { input: "0", output: "0" },
			},
		];

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ data: models }),
		}) as unknown as typeof fetch;

		const client = new ModelsClient();
		const result = await client.getModels("test-key");

		expect(result.map((m) => m.id)).toEqual(["a:chat", "c:undef"]);
	});

	describe("capability detection", () => {
		const baseModel: Model = {
			id: "vendor:model",
			object: "model",
			created: 0,
			owned_by: "vendor",
			name: "Model",
			description: "",
			context_window: 1000,
			max_tokens: 100,
			type: "language",
			pricing: { input: "0", output: "0" },
		};

		async function capabilitiesOf(model: Model) {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ data: [model] }),
			}) as unknown as typeof fetch;

			const result = await new ModelsClient().getModels("test-key");
			return result[0]?.capabilities;
		}

		it("prefers structured fields over tags", async () => {
			const capabilities = await capabilitiesOf({
				...baseModel,
				tags: [],
				modalities: { input: ["text", "image"], output: ["text"] },
				supported_parameters: ["tools", "tool_choice", "reasoning"],
			});

			expect(capabilities).toMatchObject({
				imageInput: true,
				toolCalling: true,
				reasoning: true,
			});
		});

		it("treats a present structured field as authoritative over contradicting tags", async () => {
			const capabilities = await capabilitiesOf({
				...baseModel,
				tags: ["vision", "tool-use", "reasoning"],
				modalities: { input: ["text"], output: ["text"] },
				supported_parameters: ["max_tokens", "temperature"],
			});

			expect(capabilities).toMatchObject({
				imageInput: false,
				toolCalling: false,
				reasoning: false,
			});
		});

		it("falls back to tags when structured fields are absent", async () => {
			const capabilities = await capabilitiesOf({
				...baseModel,
				tags: ["vision", "function_calling", "o3", "web-search"],
			});

			expect(capabilities).toMatchObject({
				imageInput: true,
				toolCalling: true,
				reasoning: true,
				webSearch: true,
			});
		});

		it("detects reasoning from reasoning_options alone", async () => {
			const capabilities = await capabilitiesOf({
				...baseModel,
				tags: [],
				supported_parameters: ["max_tokens"],
				reasoning_options: [{ type: "toggle" }],
			});

			// `reasoning` is sent to VS Code but is not part of the stable `LanguageModelChatCapabilities`
			// type, so it is asserted structurally rather than read as a typed property.
			expect(capabilities).toMatchObject({ reasoning: true });
		});

		it("keeps using tags for web search, which has no structured field", async () => {
			const capabilities = await capabilitiesOf({
				...baseModel,
				tags: ["web-search"],
				modalities: { input: ["text"], output: ["text"] },
				supported_parameters: ["max_tokens"],
			});

			expect(capabilities).toMatchObject({ webSearch: true });
		});
	});
});

describe("models cache", () => {
	interface PendingFetch {
		authorization: string | undefined;
		resolve: (modelIds: string[]) => void;
		reject: (status: number) => void;
	}

	let originalFetch: typeof fetch;
	let pending: PendingFetch[];

	function chatModel(id: string): Model {
		return {
			id,
			object: "model",
			created: 0,
			owned_by: "a",
			name: id,
			description: "",
			context_window: 1000,
			max_tokens: 100,
			type: "chat",
			pricing: { input: "0", output: "0" },
		};
	}

	function ids(models: { id: string }[]): string[] {
		return models.map((model) => model.id);
	}

	beforeEach(() => {
		vi.useFakeTimers();
		originalFetch = globalThis.fetch;
		pending = [];
		globalThis.fetch = vi.fn(
			(_url: string, init?: { headers?: Record<string, string> }) =>
				new Promise((resolve) => {
					pending.push({
						authorization: init?.headers?.Authorization,
						resolve: (modelIds) =>
							resolve({ ok: true, json: async () => ({ data: modelIds.map(chatModel) }) }),
						reject: (status) => resolve({ ok: false, status, statusText: "Error" }),
					});
				}),
		) as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.useRealTimers();
	});

	it("shares one fetch between concurrent calls with the same key", async () => {
		const client = new ModelsClient();
		const first = client.getModels("keyA");
		const second = client.getModels("keyA");

		expect(pending).toHaveLength(1);
		pending[0]?.resolve(["a:one"]);

		expect(ids(await first)).toEqual(["a:one"]);
		expect(ids(await second)).toEqual(["a:one"]);
	});

	it("serves a fresh cache without fetching and refetches once it expires", async () => {
		const client = new ModelsClient();
		const initial = client.getModels("keyA");
		pending[0]?.resolve(["a:one"]);
		await initial;

		vi.advanceTimersByTime(MODELS_CACHE_TTL_MS - 1);
		expect(ids(await client.getModels("keyA"))).toEqual(["a:one"]);
		expect(pending).toHaveLength(1);

		vi.advanceTimersByTime(1);
		const refetch = client.getModels("keyA");
		expect(pending).toHaveLength(2);
		pending[1]?.resolve(["a:two"]);
		expect(ids(await refetch)).toEqual(["a:two"]);
	});

	it("does not cache a failed fetch", async () => {
		const client = new ModelsClient();
		const failed = client.getModels("keyA");
		pending[0]?.reject(500);
		await expect(failed).rejects.toThrow("HTTP 500");

		const retry = client.getModels("keyA");
		expect(pending).toHaveLength(2);
		pending[1]?.resolve(["a:one"]);
		expect(ids(await retry)).toEqual(["a:one"]);
	});

	it("does not let a fetch started before invalidateCache populate the cache", async () => {
		const client = new ModelsClient();
		const stale = client.getModels("keyA");

		client.invalidateCache();
		pending[0]?.resolve(["old:model"]);
		await stale;

		const fresh = client.getModels("keyA");
		expect(pending).toHaveLength(2);
		pending[1]?.resolve(["new:model"]);
		expect(ids(await fresh)).toEqual(["new:model"]);
	});

	it("does not hand one key's in-flight fetch to a call with another key", async () => {
		const client = new ModelsClient();
		const forA = client.getModels("keyA");
		const forB = client.getModels("keyB");

		expect(pending).toHaveLength(2);
		expect(pending[1]?.authorization).toBe("Bearer keyB");
		pending[1]?.resolve(["b:model"]);
		pending[0]?.resolve(["a:model"]);

		expect(ids(await forB)).toEqual(["b:model"]);
		expect(ids(await forA)).toEqual(["a:model"]);
	});

	describe("fetch failures", () => {
		function mockResponse(response: Partial<Response>) {
			globalThis.fetch = vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
		}

		it("names the endpoint, status and gateway error message for a non-ok JSON reply", async () => {
			mockResponse({
				ok: false,
				status: 401,
				statusText: "Unauthorized",
				text: async () => JSON.stringify({ error: { message: "Invalid API key" } }),
			});

			const error = await new ModelsClient().getModels("bad-key").catch((e: unknown) => e);

			expect(error).toBeInstanceOf(ModelsFetchError);
			expect((error as ModelsFetchError).status).toBe(401);
			expect((error as Error).message).toBe(
				"HTTP 401 Unauthorized from https://ai-gateway.vercel.sh/v1/models: Invalid API key",
			);
		});

		it("includes a truncated raw body for a non-ok reply that is not JSON", async () => {
			mockResponse({
				ok: false,
				status: 502,
				statusText: "Bad Gateway",
				text: async () => `<html>${"x".repeat(1000)}</html>`,
			});

			const error = (await new ModelsClient().getModels("key").catch((e: unknown) => e)) as Error;

			expect(error.message).toContain("HTTP 502 Bad Gateway from https://ai-gateway.vercel.sh");
			expect(error.message).toContain("<html>xxx");
			expect(error.message.endsWith("...")).toBe(true);
			expect(error.message.length).toBeLessThan(700);
		});

		it("reports a successful reply whose body is not JSON", async () => {
			mockResponse({
				ok: true,
				status: 200,
				json: async () => {
					throw new SyntaxError("Unexpected token '<'");
				},
			});

			await expect(new ModelsClient().getModels("key")).rejects.toThrow(
				/Invalid JSON from https:\/\/ai-gateway\.vercel\.sh\/v1\/models: Unexpected token/,
			);
		});

		it("reports a reply without a data array instead of returning undefined", async () => {
			mockResponse({ ok: true, status: 200, json: async () => ({ models: [] }) });

			await expect(new ModelsClient().getModels("key")).rejects.toThrow(/expected a "data" array/);
		});

		it("does not cache a failure", async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
				.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const client = new ModelsClient();
			await expect(client.getModels("key")).rejects.toThrow();
			await expect(client.getModels("key")).resolves.toEqual([]);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});
	});
});
