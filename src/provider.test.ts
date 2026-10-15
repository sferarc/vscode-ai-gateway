import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelChatMessage } from "vscode";
import { ERROR_MESSAGES } from "./constants";
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
vi.mock("@ai-sdk/gateway", async (importOriginal) => ({
	...(await importOriginal<typeof import("@ai-sdk/gateway")>()),
	createGatewayProvider: vi.fn(() => () => ({})),
}));
vi.mock("ai", async (importOriginal) => ({
	...(await importOriginal<typeof import("ai")>()),
	jsonSchema: vi.fn((schema) => schema),
	streamText: vi.fn(),
}));
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
	describe("sign-in fallback", () => {
		const TOKEN = "tok_secret_value";

		async function setup(getActiveSession: () => Promise<{ accessToken: string } | null>) {
			hoisted.mockGetConfiguration.mockReturnValue({ get: (_: string, d?: unknown) => d });
			const vscode = await import("vscode");
			const getSession = vi.mocked(vscode.authentication.getSession);
			getSession.mockReset();
			const showErrorMessage = vi.mocked(vscode.window.showErrorMessage);
			showErrorMessage.mockClear();
			const { createGatewayProvider } = await import("@ai-sdk/gateway");
			const gateway = vi.mocked(createGatewayProvider);
			gateway.mockClear();
			const { streamText } = await import("ai");
			const stream = vi.mocked(streamText);
			stream.mockClear();
			const { logger } = await import("./logger");
			const logs = (["error", "warn", "info", "debug"] as const).map((level) =>
				vi
					.spyOn(logger, level)
					.mockClear()
					.mockImplementation(() => {}),
			);
			const provider = new VercelAIChatModelProvider(getActiveSession);
			const getModels = vi.spyOn(
				(provider as unknown as { modelsClient: { getModels: (key: string) => unknown } })
					.modelsClient,
				"getModels",
			);
			return {
				provider,
				getSession,
				showErrorMessage,
				gateway,
				stream,
				getModels,
				logged: () => logs.flatMap((spy) => spy.mock.calls),
				errorLog: logs[0],
			};
		}

		function expectNoTokenLogged(calls: unknown[][]) {
			for (const args of calls) {
				for (const arg of args) {
					const text = arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg);
					expect(text).not.toContain(TOKEN);
					expect(JSON.stringify(arg) ?? "").not.toContain(TOKEN);
				}
			}
		}

		async function chat(provider: VercelAIChatModelProvider) {
			const report = vi.fn();
			await provider.provideLanguageModelChatResponse(
				{ id: "openai/gpt-4o" } as never,
				[{ role: 1, content: [new hoisted.MockLanguageModelTextPart("Hello")] }] as never,
				{} as never,
				{ report },
				{
					isCancellationRequested: false,
					onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
				} as never,
			);
			return report.mock.calls.map(([part]) => (part as { value: string }).value).join("");
		}

		const secretStorageFailure = () => Promise.reject(new Error("SecretStorage unavailable"));

		it("returns no models and stays quiet when reading the session fails silently", async () => {
			const t = await setup(secretStorageFailure);

			const models = await t.provider.provideLanguageModelChatInformation(
				{ silent: true },
				{} as never,
			);

			expect(models).toEqual([]);
			expect(t.getModels).not.toHaveBeenCalled();
			expect(t.getSession).not.toHaveBeenCalled();
			expect(t.showErrorMessage).not.toHaveBeenCalled();
			expect(t.errorLog).not.toHaveBeenCalled();
		});

		it("logs and shows AUTH_FAILED when reading the session fails and prompting is allowed", async () => {
			const t = await setup(secretStorageFailure);

			const models = await t.provider.provideLanguageModelChatInformation(
				{ silent: false },
				{} as never,
			);

			expect(models).toEqual([]);
			expect(t.getSession).not.toHaveBeenCalled();
			expect(t.errorLog).toHaveBeenCalledWith(
				"Failed to get authentication session:",
				expect.objectContaining({ message: "SecretStorage unavailable" }),
			);
			expect(t.showErrorMessage).toHaveBeenCalledWith(ERROR_MESSAGES.AUTH_FAILED);
		});

		it("shows no error toast when the user declines the sign-in prompt", async () => {
			const t = await setup(async () => null);
			t.getSession.mockRejectedValue(new Error("User did not consent to login."));

			const models = await t.provider.provideLanguageModelChatInformation(
				{ silent: false },
				{} as never,
			);

			expect(models).toEqual([]);
			expect(t.showErrorMessage).not.toHaveBeenCalled();
			expect(t.errorLog).not.toHaveBeenCalled();
		});

		it("shows no error toast when VS Code cancels the sign-in", async () => {
			const t = await setup(async () => null);
			const cancelled = new Error("Canceled");
			cancelled.name = "Canceled";
			t.getSession.mockRejectedValue(cancelled);

			await t.provider.provideLanguageModelChatInformation({ silent: false }, {} as never);

			expect(t.showErrorMessage).not.toHaveBeenCalled();
			expect(t.errorLog).not.toHaveBeenCalled();
		});

		it("still shows AUTH_FAILED when sign-in fails for another reason", async () => {
			const t = await setup(async () => null);
			t.getSession.mockRejectedValue(new Error("Dynamic authentication provider not found"));

			await t.provider.provideLanguageModelChatInformation({ silent: false }, {} as never);

			expect(t.errorLog).toHaveBeenCalledWith(
				"Failed to get authentication session:",
				expect.any(Error),
			);
			expect(t.showErrorMessage).toHaveBeenCalledWith(ERROR_MESSAGES.AUTH_FAILED);
		});

		it("returns no models without a toast when sign-in resolves no session", async () => {
			const t = await setup(async () => null);
			t.getSession.mockResolvedValue(undefined as never);

			const models = await t.provider.provideLanguageModelChatInformation(
				{ silent: false },
				{} as never,
			);

			expect(models).toEqual([]);
			expect(t.getModels).not.toHaveBeenCalled();
			expect(t.showErrorMessage).not.toHaveBeenCalled();
		});

		it("returns no models without fetching when silent and signed out", async () => {
			const t = await setup(async () => null);

			const models = await t.provider.provideLanguageModelChatInformation(
				{ silent: true },
				{} as never,
			);

			expect(models).toEqual([]);
			expect(t.getModels).not.toHaveBeenCalled();
			expect(t.getSession).not.toHaveBeenCalled();
		});

		it("reports a missing key in the chat and makes no gateway request", async () => {
			const t = await setup(async () => null);
			t.getSession.mockResolvedValue(undefined as never);

			const output = await chat(t.provider);

			expect(output).toContain(`**Error:** ${ERROR_MESSAGES.API_KEY_NOT_FOUND}`);
			expect(t.gateway).not.toHaveBeenCalled();
			expect(t.stream).not.toHaveBeenCalled();
			expect(t.showErrorMessage).not.toHaveBeenCalled();
		});

		it("reports a missing key without a toast when the user cancels sign-in from a chat", async () => {
			const t = await setup(async () => null);
			t.getSession.mockRejectedValue(new Error("User did not consent to login."));

			const output = await chat(t.provider);

			expect(output).toContain(`**Error:** ${ERROR_MESSAGES.API_KEY_NOT_FOUND}`);
			expect(t.gateway).not.toHaveBeenCalled();
			expect(t.stream).not.toHaveBeenCalled();
			expect(t.showErrorMessage).not.toHaveBeenCalled();
		});

		it("never logs the access token on the sign-in paths", async () => {
			const fromSession = await setup(async () => ({ accessToken: TOKEN }));
			fromSession.getModels.mockRejectedValue(new Error("gateway down"));
			await fromSession.provider.provideLanguageModelChatInformation(
				{ silent: false },
				{} as never,
			);
			expectNoTokenLogged(fromSession.logged());

			const created = await setup(async () => null);
			created.getSession.mockResolvedValue({ accessToken: TOKEN } as never);
			created.stream.mockReturnValue({ fullStream: [] } as never);
			await chat(created.provider);
			expectNoTokenLogged(created.logged());
			expect(created.gateway).toHaveBeenCalledWith(expect.objectContaining({ apiKey: TOKEN }));
		});
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

	async function requestOptions(model: object, modelOptions?: Record<string, unknown>) {
		hoisted.mockGetConfiguration.mockReturnValue({ get: (_: string, d?: unknown) => d });

		const vscode = await import("vscode");
		vi.mocked(vscode.authentication.getSession).mockResolvedValue({ accessToken: "key" } as never);

		const { streamText } = await import("ai");
		const streamTextMock = vi.mocked(streamText);
		streamTextMock.mockClear();
		streamTextMock.mockReturnValue({ fullStream: [{ type: "text-delta", text: "hi" }] } as never);

		await createProvider().provideLanguageModelChatResponse(
			{ id: "openai/gpt-4o", ...model } as never,
			[{ role: 1, content: [new hoisted.MockLanguageModelTextPart("Hello")] }] as never,
			{ modelOptions } as never,
			{ report: vi.fn() },
			{ onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) } as never,
		);
		return streamTextMock.mock.calls[0][0];
	}

	it("leaves temperature to the provider and uses the model's output limit by default", async () => {
		const options = await requestOptions({ maxOutputTokens: 32000 });
		expect(options.temperature).toBeUndefined();
		expect(options.maxOutputTokens).toBe(32000);
	});

	it("sends no output limit when the model does not report one", async () => {
		expect((await requestOptions({ maxOutputTokens: 0 })).maxOutputTokens).toBeUndefined();
		expect((await requestOptions({})).maxOutputTokens).toBeUndefined();
	});

	it("lets the caller's model options override the defaults", async () => {
		const options = await requestOptions(
			{ maxOutputTokens: 32000 },
			{ temperature: 0.2, maxOutputTokens: 1000 },
		);
		expect(options.temperature).toBe(0.2);
		expect(options.maxOutputTokens).toBe(1000);
	});

	async function respondWithTimeout(isCancellationRequested: boolean, textBeforeStall?: string) {
		hoisted.mockGetConfiguration.mockReturnValue({ get: (_: string, d?: unknown) => d });

		const vscode = await import("vscode");
		vi.mocked(vscode.authentication.getSession).mockResolvedValue({ accessToken: "key" } as never);

		const { streamText } = await import("ai");
		const streamTextMock = vi.mocked(streamText);
		streamTextMock.mockClear();
		streamTextMock.mockReturnValue({
			fullStream: (async function* () {
				if (textBeforeStall) yield { type: "text-delta", text: textBeforeStall };
				yield { type: "abort", reason: "Chunk timeout of 30000ms exceeded" };
			})(),
		} as never);

		const report = vi.fn();
		await createProvider().provideLanguageModelChatResponse(
			{ id: "openai/gpt-4o" } as never,
			[{ role: 1, content: [new hoisted.MockLanguageModelTextPart("Hello")] }] as never,
			{} as never,
			{ report },
			{
				isCancellationRequested,
				onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
			} as never,
		);
		return { report, options: streamTextMock.mock.calls[0][0] };
	}

	it("bounds silence between chunks instead of the total response time", async () => {
		const { options } = await respondWithTimeout(false);
		expect(options.timeout).toEqual({ firstChunkMs: 30000, chunkMs: 30000 });
	});

	it("reports a timeout that the user did not cause", async () => {
		const { report } = await respondWithTimeout(false);
		expect(report).toHaveBeenCalledTimes(1);
		expect(report.mock.calls[0][0].value).toContain(
			"**Error:** Request timed out after 30000 ms with no output from the model.",
		);
	});

	it("reports a timeout after a partial answer instead of ending it silently", async () => {
		const { report } = await respondWithTimeout(false, "Half an answer");
		expect(report).toHaveBeenCalledTimes(2);
		expect(report.mock.calls[0][0].value).toBe("Half an answer");
		expect(report.mock.calls[1][0].value).toContain("**Error:** Request timed out after 30000 ms");
	});

	it("stays silent when the user cancelled", async () => {
		const { report } = await respondWithTimeout(true);
		expect(report).not.toHaveBeenCalled();
	});

	it("logs the status of a rejected request without its body and points to sign-in", async () => {
		hoisted.mockGetConfiguration.mockReturnValue({ get: (_: string, d?: unknown) => d });
		const vscode = await import("vscode");
		vi.mocked(vscode.authentication.getSession).mockResolvedValue({ accessToken: "key" } as never);

		const { APICallError, streamText } = await import("ai");
		const { GatewayAuthenticationError } = await import("@ai-sdk/gateway");
		const cause = new APICallError({
			message: "Unauthorized",
			url: "https://ai-gateway.vercel.sh/v1/ai/language-model",
			requestBodyValues: { prompt: "private prompt" },
			statusCode: 401,
		});
		vi.mocked(streamText).mockReturnValue({
			fullStream: [{ type: "error", error: new GatewayAuthenticationError({ cause }) }],
		} as never);

		const { logger } = await import("./logger");
		const logError = vi.spyOn(logger, "error").mockImplementation(() => {});
		const report = vi.fn();
		await createProvider().provideLanguageModelChatResponse(
			{ id: "openai/gpt-4o" } as never,
			[{ role: 1, content: [new hoisted.MockLanguageModelTextPart("Hello")] }] as never,
			{} as never,
			{ report },
			{ onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) } as never,
		);

		const line = logError.mock.calls.find(([message]) => message.startsWith("Chat request failed"));
		expect(line?.[0]).toMatch(
			/model=openai\/gpt-4o status=401 url=https:\/\/ai-gateway\.vercel\.sh\/v1\/ai\/language-model retryable=false elapsedMs=\d+/,
		);
		expect(JSON.stringify(logError.mock.calls)).not.toContain("private prompt");
		expect(report.mock.calls[0][0].value).toContain("Vercel AI Gateway: Manage Authentication");
		logError.mockRestore();
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

	it("notes when the answer stopped at the output limit", () => {
		const provider = createProvider();
		const progress = { report: vi.fn() };
		expect(
			provider.handleStreamChunk({ type: "finish", finishReason: "length" } as any, progress),
		).toBe(true);
		expect(progress.report).toHaveBeenCalledTimes(1);
		expect(progress.report.mock.calls[0][0].value).toContain("output token limit");

		progress.report.mockClear();
		provider.handleStreamChunk({ type: "finish", finishReason: "stop" } as any, progress);
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

describe("tool message conversion", () => {
	const {
		MockLanguageModelTextPart,
		MockLanguageModelToolCallPart,
		MockLanguageModelToolResultPart,
	} = hoisted;
	const { MockLanguageModelDataPart } = hoisted;

	function message(role: 1 | 2, content: unknown[]) {
		return { role, content } as unknown as LanguageModelChatMessage;
	}

	function toolResultOutput(content: unknown[]) {
		const { messages } = convertMessages([
			message(1, [new MockLanguageModelTextPart("Run it")]),
			message(2, [new MockLanguageModelToolCallPart("c1", "readFile", {})]),
			message(1, [new MockLanguageModelToolResultPart("c1", content)]),
		]);
		const tool = messages.find((m) => m.role === "tool");
		expect(tool).toBeDefined();
		return (tool?.content as any)?.[0]?.output;
	}

	it("serialises a JSON data part tool result instead of dropping it", () => {
		const output = toolResultOutput([MockLanguageModelDataPart.json({ ok: true, items: [1, 2] })]);

		expect(output).toEqual({ type: "text", value: '{"ok":true,"items":[1,2]}' });
	});

	it("sends an image data part tool result as file content", () => {
		const bytes = new Uint8Array([137, 80, 78, 71]);
		const output = toolResultOutput([
			new MockLanguageModelTextPart("Screenshot:"),
			MockLanguageModelDataPart.image(bytes, "image/png"),
		]);

		expect(output).toEqual({
			type: "content",
			value: [
				{ type: "text", text: "Screenshot:" },
				{ type: "file", mediaType: "image/png", data: { type: "data", data: bytes } },
			],
		});
	});

	it("emits a placeholder result for content it cannot convert", () => {
		const output = toolResultOutput([{ value: { node: "prompt-tsx" } }]);

		expect(output).toEqual({ type: "text", value: "[Unsupported tool result content]" });
	});

	it("joins text parts of a tool result without inserting separators", () => {
		const output = toolResultOutput([
			new MockLanguageModelTextPart("con"),
			new MockLanguageModelTextPart("tent"),
		]);

		expect(output).toEqual({ type: "text", value: "content" });
	});

	it("groups parallel tool calls into one assistant message followed by one tool message", () => {
		const { messages } = convertMessages([
			message(1, [new MockLanguageModelTextPart("Check both files")]),
			message(2, [
				new MockLanguageModelTextPart("Reading them now."),
				new MockLanguageModelToolCallPart("c1", "readFile", { path: "a" }),
				new MockLanguageModelToolCallPart("c2", "readFile", { path: "b" }),
			]),
			message(1, [
				new MockLanguageModelToolResultPart("c1", [new MockLanguageModelTextPart("A")]),
				new MockLanguageModelToolResultPart("c2", [new MockLanguageModelTextPart("B")]),
			]),
		]);

		expect(messages).toEqual([
			{ role: "user", content: "Check both files" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Reading them now." },
					{ type: "tool-call", toolCallId: "c1", toolName: "readFile", input: { path: "a" } },
					{ type: "tool-call", toolCallId: "c2", toolName: "readFile", input: { path: "b" } },
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "c1",
						toolName: "readFile",
						output: { type: "text", value: "A" },
					},
					{
						type: "tool-result",
						toolCallId: "c2",
						toolName: "readFile",
						output: { type: "text", value: "B" },
					},
				],
			},
		]);
	});

	it("keeps user text that accompanies tool results after the tool message", () => {
		const { messages } = convertMessages([
			message(1, [new MockLanguageModelTextPart("Go")]),
			message(2, [new MockLanguageModelToolCallPart("c1", "run", {})]),
			message(1, [
				new MockLanguageModelToolResultPart("c1", [new MockLanguageModelTextPart("done")]),
				new MockLanguageModelTextPart("Now summarise"),
			]),
		]);

		expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"]);
		expect(messages[3]).toEqual({ role: "user", content: "Now summarise" });
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
