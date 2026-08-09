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
	authentication: { getSession: vi.fn(), onDidChangeSessions: vi.fn(() => ({ dispose: vi.fn() })) },
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

vi.mock("./auth", () => ({ VERCEL_AI_AUTH_PROVIDER_ID: "vercelAiGateway" }));
vi.mock("@ai-sdk/gateway", () => ({ createGatewayProvider: vi.fn(() => () => ({})) }));
vi.mock("ai", () => ({ jsonSchema: vi.fn((schema) => schema), streamText: vi.fn() }));
vi.mock("./models", () => ({
	ModelsClient: class {
		getModels = vi.fn();
		invalidateCache = vi.fn();
	},
}));

function createProvider() {
	return new VercelAIChatModelProvider();
}

describe("session change refresh", () => {
	it("invalidates cache and fires model info change when our auth provider's sessions change", async () => {
		const vscode = await import("vscode");
		const onDidChangeSessions = vscode.authentication.onDidChangeSessions as unknown as ReturnType<
			typeof vi.fn
		>;
		onDidChangeSessions.mockClear();

		const provider = createProvider();
		const fireSpy = vi.spyOn(
			(provider as unknown as { modelInfoChangeEmitter: { fire: () => void } })
				.modelInfoChangeEmitter,
			"fire",
		);
		const invalidateSpy = vi.spyOn(
			(provider as unknown as { modelsClient: { invalidateCache: () => void } }).modelsClient,
			"invalidateCache",
		);

		const handler = onDidChangeSessions.mock.calls.at(-1)?.[0] as (event: {
			provider: { id: string };
		}) => void;
		expect(handler).toBeTypeOf("function");

		handler({ provider: { id: "vercelAiGateway" } });
		expect(invalidateSpy).toHaveBeenCalledTimes(1);
		expect(fireSpy).toHaveBeenCalledTimes(1);

		handler({ provider: { id: "github" } });
		expect(invalidateSpy).toHaveBeenCalledTimes(1);
		expect(fireSpy).toHaveBeenCalledTimes(1);
	});
});

describe("active session", () => {
	async function mockedGetSession() {
		const vscode = await import("vscode");
		const getSession = vi.mocked(vscode.authentication.getSession);
		getSession.mockClear();
		getSession.mockResolvedValue({ accessToken: "created" } as never);
		return getSession;
	}

	it("reads the token from our own auth provider instead of authentication.getSession", async () => {
		const getSession = await mockedGetSession();
		const provider = new VercelAIChatModelProvider(async () => ({ accessToken: "active" }));
		const getModels = vi.spyOn(
			(provider as unknown as { modelsClient: { getModels: (key: string) => unknown } })
				.modelsClient,
			"getModels",
		);

		await provider.provideLanguageModelChatInformation({ silent: true }, {} as never);

		expect(getModels).toHaveBeenCalledWith("active");
		expect(getSession).not.toHaveBeenCalled();
	});

	it("stays silent when there is no session and silent mode is requested", async () => {
		const getSession = await mockedGetSession();
		const provider = new VercelAIChatModelProvider(async () => null);

		const models = await provider.provideLanguageModelChatInformation(
			{ silent: true },
			{} as never,
		);

		expect(models).toEqual([]);
		expect(getSession).not.toHaveBeenCalled();
	});

	it("asks VS Code to start sign-in when there is no session and prompting is allowed", async () => {
		const getSession = await mockedGetSession();
		const provider = new VercelAIChatModelProvider(async () => null);
		const getModels = vi.spyOn(
			(provider as unknown as { modelsClient: { getModels: (key: string) => unknown } })
				.modelsClient,
			"getModels",
		);

		await provider.provideLanguageModelChatInformation({ silent: false }, {} as never);

		expect(getSession).toHaveBeenCalledWith("vercelAiGateway", [], { createIfNone: true });
		expect(getModels).toHaveBeenCalledWith("created");
	});
});

describe("provideLanguageModelChatResponse", () => {
	it("sends the system prompt via instructions, not inside messages", async () => {
		hoisted.mockGetConfiguration.mockReturnValue({ get: (_: string, d?: unknown) => d });

		const vscode = await import("vscode");
		const getSession = vi.mocked(vscode.authentication.getSession);
		getSession.mockResolvedValue({ accessToken: "key" } as never);

		const { streamText } = await import("ai");
		const streamTextMock = vi.mocked(streamText);
		streamTextMock.mockClear();
		streamTextMock.mockReturnValue({ fullStream: [{ type: "text-delta", text: "hi" }] } as never);

		const provider = createProvider();
		const chatMessages = [
			{ role: 2, content: [new hoisted.MockLanguageModelTextPart("You are helpful.")] },
			{ role: 1, content: [new hoisted.MockLanguageModelTextPart("Hello")] },
		] as unknown as LanguageModelChatMessage[];

		await provider.provideLanguageModelChatResponse(
			{ id: "openai/gpt-4o" } as never,
			chatMessages,
			{} as never,
			{ report: vi.fn() },
			{ onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) } as never,
		);

		const options = streamTextMock.mock.calls[0][0];
		expect(options.instructions).toBe("You are helpful.");
		expect(options.messages).toEqual([{ role: "user", content: "Hello" }]);
	});
});

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

		const { messages: converted } = convertMessages(messages);
		const toolResult = converted.find((m) => m.role === "tool" && Array.isArray(m.content));

		expect(toolResult).toBeDefined();
		expect((toolResult?.content as any)?.[0]?.toolName).toBe("searchDocs");
	});
});

describe("instruction extraction", () => {
	function textMessage(role: 1 | 2, text: string) {
		return {
			role,
			content: [new hoisted.MockLanguageModelTextPart(text)],
		} as unknown as LanguageModelChatMessage;
	}

	it("moves pre-user assistant messages into instructions instead of the messages array", () => {
		const { messages, instructions } = convertMessages([
			textMessage(2, "You are a helpful assistant."),
			textMessage(1, "Hello"),
		]);

		expect(instructions).toBe("You are a helpful assistant.");
		expect(messages).toEqual([{ role: "user", content: "Hello" }]);
	});

	it("joins multiple pre-user messages into a single instruction block", () => {
		const { messages, instructions } = convertMessages([
			textMessage(2, "First rule."),
			textMessage(2, "Second rule."),
			textMessage(1, "Hello"),
		]);

		expect(instructions).toBe("First rule.\n\nSecond rule.");
		expect(messages).toHaveLength(1);
	});

	it("leaves assistant replies after the first user message in the conversation", () => {
		const { messages, instructions } = convertMessages([
			textMessage(1, "Hello"),
			textMessage(2, "Hi there"),
			textMessage(1, "How are you?"),
		]);

		expect(instructions).toBeUndefined();
		expect(messages).toEqual([
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there" },
			{ role: "user", content: "How are you?" },
		]);
	});

	it("keeps assistant messages when the conversation has no user message", () => {
		const { messages, instructions } = convertMessages([textMessage(2, "Only an assistant turn")]);

		expect(instructions).toBeUndefined();
		expect(messages).toEqual([{ role: "assistant", content: "Only an assistant turn" }]);
	});

	it("never emits system role messages in the messages array", () => {
		const { messages } = convertMessages([
			textMessage(2, "You are a helpful assistant."),
			textMessage(1, "Hello"),
		]);

		expect(messages.some((msg) => msg.role === "system")).toBe(false);
	});
});
