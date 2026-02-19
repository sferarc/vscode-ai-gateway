import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelChatMessage } from "vscode";
import {
	convertMessages,
	convertSingleMessage,
	isValidMimeType,
	VercelAIChatModelProvider,
} from "./provider";

const hoisted = vi.hoisted(() => {
	class MockEventEmitter {
		event = vi.fn();
		fire = vi.fn();
		dispose = vi.fn();
	}

	class MockLanguageModelTextPart {
		constructor(public value: string) {}
	}

	class MockLanguageModelToolCallPart {
		constructor(
			public callId: string,
			public name: string,
			public input: unknown,
		) {}
	}

	class MockLanguageModelToolResultPart {
		constructor(
			public callId: string,
			public content: unknown[],
		) {}
	}

	class MockLanguageModelDataPart {
		constructor(
			public data: Uint8Array,
			public mimeType: string,
		) {}
		static image(data: Uint8Array, mimeType: string) {
			return new MockLanguageModelDataPart(data, mimeType);
		}
		static text(value: string, mimeType: string) {
			return new MockLanguageModelDataPart(new TextEncoder().encode(value), mimeType);
		}
		static json(value: unknown, mimeType = "application/json") {
			return new MockLanguageModelDataPart(
				new TextEncoder().encode(JSON.stringify(value)),
				mimeType,
			);
		}
	}

	return {
		MockEventEmitter,
		mockGetConfiguration: vi.fn(),
		MockLanguageModelTextPart,
		MockLanguageModelToolCallPart,
		MockLanguageModelToolResultPart,
		MockLanguageModelDataPart,
	};
});

vi.mock("vscode", () => ({
	EventEmitter: hoisted.MockEventEmitter,
	authentication: { getSession: vi.fn() },
	window: {
		showErrorMessage: vi.fn(),
		createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() })),
	},
	workspace: { getConfiguration: hoisted.mockGetConfiguration },
	LanguageModelTextPart: hoisted.MockLanguageModelTextPart,
	LanguageModelToolCallPart: hoisted.MockLanguageModelToolCallPart,
	LanguageModelToolResultPart: hoisted.MockLanguageModelToolResultPart,
	LanguageModelDataPart: hoisted.MockLanguageModelDataPart,
	LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
	LanguageModelChatToolMode: { Auto: "auto", Required: "required" },
}));

vi.mock("./auth", () => ({ VERCEL_AI_AUTH_PROVIDER_ID: "vercelAiAuth" }));
vi.mock("@ai-sdk/gateway", () => ({ createGatewayProvider: vi.fn(() => () => ({})) }));
vi.mock("ai", () => ({ jsonSchema: vi.fn((schema) => schema), streamText: vi.fn() }));
vi.mock("./models", () => ({
	ModelsClient: class {
		getModels = vi.fn();
	},
}));

function createProvider() {
	return new VercelAIChatModelProvider();
}

describe("isValidMimeType", () => {
	it("accepts valid MIME types", () => {
		const valid = ["text/plain", "image/png", "application/json", "audio/mpeg", "model/gltf+json"];
		for (const mime of valid) expect(isValidMimeType(mime)).toBe(true);
	});

	it("rejects invalid MIME types", () => {
		const invalid = ["cache_control", "textplain", "text/", "", "invalid", "a/b/c"];
		for (const mime of invalid) expect(isValidMimeType(mime)).toBe(false);
	});
});

describe("handleStreamChunk", () => {
	beforeEach(() => {
		hoisted.mockGetConfiguration.mockReturnValue({ get: (_: string, d?: unknown) => d });
	});

	it("ignores lifecycle events without reporting", () => {
		const provider = createProvider();
		const progress = { report: vi.fn() };
		const ignored = [
			"start",
			"finish",
			"abort",
			"text-start",
			"text-end",
			"source",
			"tool-result",
			"tool-input-start",
			"tool-input-delta",
			"tool-input-end",
			"tool-output-denied",
		];
		for (const type of ignored) provider.handleStreamChunk({ type } as any, progress);
		expect(progress.report).not.toHaveBeenCalled();
	});

	it("reports text-delta chunks using chunk.text", () => {
		const provider = createProvider();
		const progress = { report: vi.fn() };
		provider.handleStreamChunk({ type: "text-delta", text: "hello" } as any, progress);
		expect(progress.report).toHaveBeenCalledTimes(1);
		expect(progress.report.mock.calls[0][0]).toBeInstanceOf(hoisted.MockLanguageModelTextPart);
	});

	it("reports tool-call chunks using chunk.input", () => {
		const provider = createProvider();
		const progress = { report: vi.fn() };
		provider.handleStreamChunk(
			{ type: "tool-call", toolCallId: "c1", toolName: "search", input: { query: "test" } } as any,
			progress,
		);
		expect(progress.report).toHaveBeenCalledTimes(1);
		const reported = progress.report.mock.calls[0][0];
		expect(reported).toBeInstanceOf(hoisted.MockLanguageModelToolCallPart);
		expect(reported.input).toEqual({ query: "test" });
	});

	it("reports tool-error chunks as errors", () => {
		const provider = createProvider();
		const progress = { report: vi.fn() };
		const result = provider.handleStreamChunk(
			{ type: "tool-error", toolCallId: "c1", toolName: "search", error: new Error("fail") } as any,
			progress,
		);
		expect(result).toBe(true);
		expect(progress.report).toHaveBeenCalledTimes(1);
		expect(progress.report.mock.calls[0][0].value).toContain("fail");
	});

	it("handles file chunks with valid MIME types, skips invalid", () => {
		const provider = createProvider();
		const valid = { report: vi.fn() };
		const invalid = { report: vi.fn() };

		provider.handleStreamChunk(
			{ type: "file", file: { uint8Array: new Uint8Array([1]), mediaType: "image/png" } } as any,
			valid,
		);
		provider.handleStreamChunk(
			{
				type: "file",
				file: { uint8Array: new Uint8Array([1]), mediaType: "cache_control" },
			} as any,
			invalid,
		);

		expect(valid.report).toHaveBeenCalledTimes(1);
		expect(invalid.report).not.toHaveBeenCalled();
	});

	it("handles unknown chunk types without crashing", () => {
		const provider = createProvider();
		const progress = { report: vi.fn() };
		expect(() =>
			provider.handleStreamChunk({ type: "unknown-type" } as any, progress),
		).not.toThrow();
	});
});

describe("convertMessages", () => {
	it("converts various content types without crashing", () => {
		const contents = [
			[new hoisted.MockLanguageModelTextPart("hello")],
			[new hoisted.MockLanguageModelToolCallPart("c1", "tool", {})],
			[new hoisted.MockLanguageModelToolResultPart("c1", [{ value: "result" }])],
			[],
		];
		contents.forEach((content) => {
			const msg = { role: 1, content } as unknown as LanguageModelChatMessage;
			expect(() => convertSingleMessage(msg, {})).not.toThrow();
		});
	});

	it("maps tool result names from prior tool calls", () => {
		const messages = [
			{ role: 2, content: [new hoisted.MockLanguageModelToolCallPart("c1", "searchDocs", {})] },
			{
				role: 2,
				content: [new hoisted.MockLanguageModelToolResultPart("c1", [{ value: "result" }])],
			},
		] as unknown as LanguageModelChatMessage[];

		const converted = convertMessages(messages);
		const toolResult = converted.find((m) => m.role === "tool" && Array.isArray(m.content));

		expect(toolResult).toBeDefined();
		expect((toolResult?.content as any)?.[0]?.toolName).toBe("searchDocs");
	});
});
