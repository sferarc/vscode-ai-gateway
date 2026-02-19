import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
	workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn((_, d) => d) })) },
	EventEmitter: class {
		event = vi.fn();
		fire = vi.fn();
		dispose = vi.fn();
	},
}));

import { type Model, ModelsClient } from "./models";

describe("ModelsClient", () => {
	let originalFetch: typeof fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
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
		expect(result[0].capabilities).toMatchObject({ imageInput: true, toolCalling: true });
		expect(result[1].capabilities).toMatchObject({ reasoning: true, webSearch: true });
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
});
