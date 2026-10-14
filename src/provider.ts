import { createGatewayProvider } from "@ai-sdk/gateway";
import {
	type ImagePart,
	jsonSchema,
	type ModelMessage,
	streamText,
	type TextPart,
	type TextStreamPart,
	type ToolCallPart,
	type ToolResultPart,
	type ToolSet,
} from "ai";
import * as vscode from "vscode";
import {
	authentication,
	type CancellationToken,
	type LanguageModelChatInformation,
	type LanguageModelChatMessage,
	LanguageModelChatMessageRole,
	type LanguageModelChatProvider,
	LanguageModelChatToolMode,
	LanguageModelDataPart,
	type LanguageModelResponsePart,
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	type Progress,
	type ProvideLanguageModelChatResponseOptions,
	window,
} from "vscode";

import { VERCEL_AI_AUTH_PROVIDER_ID } from "./auth";
import { getConfig } from "./config";
import { ERROR_MESSAGES } from "./constants";
import { extractErrorMessage, logger } from "./logger";
import { ModelsClient } from "./models";

type StreamChunk = TextStreamPart<ToolSet>;

const MIME_TYPE_PATTERN = /^[a-z]+\/[a-z0-9.+-]+$/i;

/** The part of an authentication session the chat provider needs to talk to the gateway. */
interface ActiveSession {
	accessToken: string;
}

export function isValidMimeType(mimeType: string): boolean {
	return MIME_TYPE_PATTERN.test(mimeType);
}

export class VercelAIChatModelProvider implements LanguageModelChatProvider, vscode.Disposable {
	private modelsClient = new ModelsClient();
	private readonly modelInfoChangeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this.modelInfoChangeEmitter.event;
	private readonly sessionChangeSubscription: vscode.Disposable;

	/**
	 * @param getActiveSession Resolves the session the user has made active, read straight from the
	 * authentication provider this extension registers, so requests use that session rather than
	 * whichever one VS Code happens to prefer.
	 */
	constructor(private readonly getActiveSession?: () => Promise<ActiveSession | null>) {
		this.sessionChangeSubscription = authentication.onDidChangeSessions((event) => {
			if (event.provider.id !== VERCEL_AI_AUTH_PROVIDER_ID) return;
			this.modelsClient.invalidateCache();
			this.modelInfoChangeEmitter.fire();
		});
	}

	dispose(): void {
		this.sessionChangeSubscription.dispose();
		this.modelInfoChangeEmitter.dispose();
	}

	async provideLanguageModelChatInformation(
		options: { silent: boolean },
		_token: CancellationToken,
	): Promise<LanguageModelChatInformation[]> {
		const apiKey = await this.getApiKey(options.silent);
		if (!apiKey) {
			return [];
		}

		try {
			const models = await this.modelsClient.getModels(apiKey);
			logger.info(`Loaded ${models.length} models from Vercel AI Gateway`);
			return models;
		} catch (error) {
			logger.error(ERROR_MESSAGES.MODELS_FETCH_FAILED, error);
			return [];
		}
	}

	async provideLanguageModelChatResponse(
		model: LanguageModelChatInformation,
		chatMessages: readonly LanguageModelChatMessage[],
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart>,
		token: CancellationToken,
	): Promise<void> {
		logger.info(`Chat request to ${model.id} with ${chatMessages.length} messages`);

		const abortController = new AbortController();
		const abortSubscription = token.onCancellationRequested(() => abortController.abort());
		let responseSent = false;

		try {
			const apiKey = await this.getApiKey(false);
			if (!apiKey) {
				throw new Error(ERROR_MESSAGES.API_KEY_NOT_FOUND);
			}

			const config = getConfig();
			const gateway = createGatewayProvider({
				apiKey,
				baseURL: `${config.endpoint.replace(/\/+$/, "")}/v1/ai`,
			});

			const tools = this.buildToolSet(options.tools);
			const toolChoice = this.getToolChoice(options.toolMode, tools);

			const { messages, instructions } = convertMessages(chatMessages);

			const response = streamText({
				model: gateway(model.id),
				messages,
				instructions,
				toolChoice,
				temperature: options.modelOptions?.temperature ?? 0.7,
				maxOutputTokens: options.modelOptions?.maxOutputTokens ?? 4096,
				tools: Object.keys(tools).length > 0 ? tools : undefined,
				abortSignal: abortController.signal,
				timeout: { firstChunkMs: config.timeout, chunkMs: config.timeout },
			});

			for await (const chunk of response.fullStream) {
				// streamText ends the stream with an abort part instead of throwing when a chunk timeout fires.
				if (chunk.type === "abort") {
					if (!token.isCancellationRequested && !abortController.signal.aborted) {
						logger.error("Stream aborted:", chunk.reason);
						this.reportTimeout(progress);
					}
					return;
				}
				const emitted = this.handleStreamChunk(chunk, progress);
				if (emitted) responseSent = true;
			}

			if (!responseSent) {
				logger.error("Stream completed with no content");
				progress.report(new LanguageModelTextPart("**Error**: No response received from model."));
			}

			logger.info(`Chat request completed for ${model.id}`);
		} catch (error) {
			if (token.isCancellationRequested || abortController.signal.aborted) {
				logger.debug("Request was cancelled");
				return;
			}

			logger.error("Exception during streaming:", error);
			if (this.isAbortError(error)) {
				this.reportTimeout(progress);
			} else {
				progress.report(
					new LanguageModelTextPart(`\n\n**Error:** ${extractErrorMessage(error)}\n\n`),
				);
			}
		} finally {
			abortSubscription.dispose();
		}
	}

	async provideTokenCount(
		_model: LanguageModelChatInformation,
		text: string | LanguageModelChatMessage,
		_token: CancellationToken,
	): Promise<number> {
		if (typeof text === "string") {
			return Math.ceil(text.length / 4);
		}

		let total = 0;
		for (const part of text.content) {
			if (part instanceof LanguageModelTextPart) {
				total += Math.ceil(part.value.length / 4);
			}
		}
		return total;
	}

	private buildToolSet(
		tools?: readonly { name: string; description?: string; inputSchema?: unknown }[],
	): ToolSet {
		const toolSet: ToolSet = {};
		for (const { name, description, inputSchema } of tools ?? []) {
			// ToolSet's complex union type requires a cast here; the shape is correct
			// (inputSchema from jsonSchema() satisfies Tool's FlexibleSchema requirement)
			toolSet[name] = {
				description,
				inputSchema: jsonSchema(inputSchema ?? { type: "object", properties: {} }),
			} as ToolSet[string];
		}
		return toolSet;
	}

	private getToolChoice(
		toolMode: LanguageModelChatToolMode | undefined,
		tools: ToolSet,
	): "auto" | "required" | "none" {
		if (toolMode === LanguageModelChatToolMode.Required) return "required";
		if (Object.keys(tools).length === 0) return "none";
		return "auto";
	}

	private reportTimeout(progress: Progress<LanguageModelResponsePart>): void {
		const message = `Request timed out after ${getConfig().timeout} ms with no output from the model.`;
		progress.report(new LanguageModelTextPart(`\n\n**Error:** ${message}\n\n`));
	}

	private isAbortError(error: unknown): boolean {
		if (!(error instanceof Error)) return false;
		return error.name === "AbortError" || error.name === "TimeoutError";
	}

	/**
	 * Reads the token from our own authentication provider instead of `authentication.getSession`.
	 * Sessions created through the provider interface never go through the consumer code path that
	 * records an access grant, so VS Code answers `undefined` for them when asked silently, even
	 * though this extension owns them. `authentication.getSession` is only used as a fallback to
	 * start the sign-in flow when there is no session at all.
	 */
	private async getApiKey(silent: boolean): Promise<string | undefined> {
		try {
			const session = await this.getActiveSession?.();
			if (session) {
				return session.accessToken;
			}

			if (silent) {
				return undefined;
			}

			const created = await authentication.getSession(VERCEL_AI_AUTH_PROVIDER_ID, [], {
				createIfNone: true,
			});
			return created?.accessToken;
		} catch (error) {
			if (!silent) {
				logger.error("Failed to get authentication session:", error);
				window.showErrorMessage(ERROR_MESSAGES.AUTH_FAILED);
			}
			return undefined;
		}
	}

	handleStreamChunk(chunk: StreamChunk, progress: Progress<LanguageModelResponsePart>): boolean {
		switch (chunk.type) {
			case "text-delta": {
				if (chunk.text) {
					progress.report(new LanguageModelTextPart(chunk.text));
					return true;
				}
				return false;
			}

			case "reasoning-delta":
				return this.handleReasoningChunk(chunk.text, progress);

			case "file":
				return this.handleFileChunk(chunk.file, progress);

			case "error":
				this.reportError(chunk.error, progress);
				return true;

			case "tool-call": {
				progress.report(
					new LanguageModelToolCallPart(chunk.toolCallId, chunk.toolName, chunk.input),
				);
				logger.debug(`Tool call: ${chunk.toolName} (${chunk.toolCallId})`);
				return true;
			}

			case "tool-error": {
				logger.error(`Tool error in ${chunk.toolName}:`, chunk.error);
				this.reportError(chunk.error, progress);
				return true;
			}

			// Lifecycle events — no content to emit
			case "start":
			case "finish":
			case "start-step":
			case "finish-step":
			case "abort":
			case "text-start":
			case "text-end":
			case "reasoning-start":
			case "reasoning-end":
			case "source":
			case "tool-result":
			case "tool-input-start":
			case "tool-input-delta":
			case "tool-input-end":
			case "tool-output-denied":
				return false;

			default:
				return false;
		}
	}

	private handleReasoningChunk(
		text: string,
		progress: Progress<LanguageModelResponsePart>,
	): boolean {
		// LanguageModelThinkingPart may not exist in older VS Code versions
		const vsAny = vscode as Record<string, unknown>;
		const ThinkingCtor = vsAny.LanguageModelThinkingPart as
			| (new (
					text: string,
			  ) => LanguageModelResponsePart)
			| undefined;

		if (ThinkingCtor && text) {
			progress.report(new ThinkingCtor(text));
			return true;
		}
		return false;
	}

	private handleFileChunk(
		file: { uint8Array: Uint8Array; mediaType: string },
		progress: Progress<LanguageModelResponsePart>,
	): boolean {
		const { mediaType, uint8Array: data } = file;
		if (!mediaType || !isValidMimeType(mediaType)) {
			logger.warn(`Unsupported file mime type: ${mediaType ?? "unknown"}`);
			return false;
		}

		try {
			if (mediaType.startsWith("image/")) {
				progress.report(LanguageModelDataPart.image(data, mediaType));
			} else if (mediaType === "application/json" || mediaType.endsWith("+json")) {
				const jsonValue = JSON.parse(new TextDecoder().decode(data));
				progress.report(LanguageModelDataPart.json(jsonValue, mediaType));
			} else if (mediaType.startsWith("text/")) {
				progress.report(LanguageModelDataPart.text(new TextDecoder().decode(data), mediaType));
			} else {
				progress.report(new LanguageModelDataPart(data, mediaType));
			}
			return true;
		} catch (error) {
			logger.warn("Failed to process file chunk:", error);
			return false;
		}
	}

	private reportError(error: unknown, progress: Progress<LanguageModelResponsePart>): void {
		logger.error("Stream error:", error);
		const message = extractErrorMessage(error);
		progress.report(new LanguageModelTextPart(`\n\n**Error:** ${message}\n\n`));
	}
}

// Message conversion utilities

export interface ConvertedMessages {
	/** Conversation messages, for the `messages` field. Never contains `system` role messages. */
	messages: ModelMessage[];
	/** System prompt extracted from the messages preceding the first user message. */
	instructions: string | undefined;
}

export function convertMessages(messages: readonly LanguageModelChatMessage[]): ConvertedMessages {
	const toolNameMap: Record<string, string> = {};
	for (const msg of messages) {
		for (const part of msg.content) {
			if (part instanceof LanguageModelToolCallPart) {
				toolNameMap[part.callId] = part.name;
			}
		}
	}

	const result = messages
		.flatMap((msg) => convertSingleMessage(msg, toolNameMap))
		.filter(isValidMessage);

	return extractInstructions(result);
}

type ContentPart = TextPart | ImagePart | ToolCallPart;
type ToolResultOutput = ToolResultPart["output"];
type ToolResultContent = Extract<ToolResultOutput, { type: "content" }>["value"];

/**
 * Converts one VS Code message. Tool calls stay in a single assistant message alongside its text,
 * and all tool results go in a single tool message, because OpenAI-style APIs require an assistant
 * message with tool calls to be followed directly by the results for every one of them.
 */
export function convertSingleMessage(
	msg: LanguageModelChatMessage,
	toolNameMap: Record<string, string>,
): ModelMessage[] {
	const role = msg.role === LanguageModelChatMessageRole.User ? "user" : "assistant";
	const parts: ContentPart[] = [];
	const toolCalls: ToolCallPart[] = [];
	const toolResults: ToolResultPart[] = [];

	for (const part of msg.content) {
		if (typeof part !== "object" || part === null) continue;

		if (isTextPart(part)) {
			parts.push({ type: "text", text: part.value });
		} else if (part instanceof LanguageModelDataPart) {
			if (part.mimeType.startsWith("image/")) {
				const base64 = Buffer.from(part.data).toString("base64");
				parts.push({ type: "image", image: `data:${part.mimeType};base64,${base64}` });
			} else {
				parts.push({ type: "text", text: new TextDecoder().decode(part.data) });
			}
		} else if (part instanceof LanguageModelToolCallPart) {
			const call: ToolCallPart = {
				type: "tool-call",
				toolName: part.name,
				toolCallId: part.callId,
				input: part.input,
			};
			if (role === "assistant") parts.push(call);
			else toolCalls.push(call);
		} else if (part instanceof LanguageModelToolResultPart) {
			toolResults.push(convertToolResult(part, toolNameMap));
		}
	}

	const message = createMessage(role, parts);
	const callMessage: ModelMessage[] =
		toolCalls.length > 0 ? [{ role: "assistant", content: toolCalls }] : [];
	const toolMessage: ModelMessage[] =
		toolResults.length > 0 ? [{ role: "tool", content: toolResults }] : [];

	// Results answer calls made earlier, so they precede this message unless it makes the calls itself.
	const results = parts.some((p) => p.type === "tool-call")
		? [message, ...toolMessage]
		: [...callMessage, ...toolMessage, message];

	const valid = results.filter(isValidMessage);
	return valid.length > 0 ? valid : [{ role, content: "" }];
}

function createMessage(role: "user" | "assistant", parts: ContentPart[]): ModelMessage {
	if (parts.every((p) => p.type === "text")) {
		return { role, content: parts.map((p) => p.text).join("") };
	}

	if (role === "user") {
		return { role, content: parts.filter((p) => p.type !== "tool-call") };
	}

	const content: Array<TextPart | ToolCallPart> = [];
	for (const part of parts) {
		const last = content.at(-1);
		if (part.type === "tool-call") {
			content.push(part);
			continue;
		}
		const text = part.type === "text" ? part.text : "[Image]";
		if (last?.type === "text") last.text += text;
		else if (text.length > 0) content.push({ type: "text", text });
	}

	if (content.every((p) => p.type === "text")) {
		return { role, content: content.map((p) => p.text).join("") };
	}
	return { role, content };
}

function isTextPart(part: object): part is { value: string } {
	return "value" in part && typeof (part as { value: unknown }).value === "string";
}

function convertToolResult(
	part: LanguageModelToolResultPart,
	toolNameMap: Record<string, string>,
): ToolResultPart {
	const toolName = toolNameMap[part.callId] ?? "unknown_tool";
	if (toolName === "unknown_tool") {
		logger.warn(`Tool result references unknown callId: ${part.callId}`);
	}
	return {
		type: "tool-result",
		toolCallId: part.callId,
		toolName,
		output: convertToolResultOutput(part.content),
	};
}

/** Every result part yields some output, so a tool call is never left without a matching result. */
function convertToolResultOutput(content: readonly unknown[]): ToolResultOutput {
	const items: ToolResultContent = [];
	const appendText = (text: string) => {
		const last = items.at(-1);
		if (last?.type === "text") last.text += text;
		else items.push({ type: "text", text });
	};

	for (const part of content) {
		if (typeof part !== "object" || part === null) {
			appendText(UNSUPPORTED_TOOL_RESULT);
		} else if (isTextPart(part)) {
			appendText(part.value);
		} else if (part instanceof LanguageModelDataPart) {
			if (part.mimeType === CACHE_CONTROL_MIME_TYPE) continue;
			if (part.mimeType.startsWith("image/")) {
				items.push({
					type: "file",
					mediaType: part.mimeType,
					data: { type: "data", data: part.data },
				});
			} else if (isTextualMimeType(part.mimeType)) {
				appendText(new TextDecoder().decode(part.data));
			} else {
				appendText(UNSUPPORTED_TOOL_RESULT);
			}
		} else {
			appendText(UNSUPPORTED_TOOL_RESULT);
		}
	}

	if (items.every((item) => item.type === "text")) {
		return { type: "text", value: items.map((item) => item.text).join("") };
	}
	return { type: "content", value: items };
}

const UNSUPPORTED_TOOL_RESULT = "[Unsupported tool result content]";
/** VS Code marks prompt cache breakpoints with a data part of this type; it carries no content. */
const CACHE_CONTROL_MIME_TYPE = "cache_control";

function isTextualMimeType(mimeType: string): boolean {
	return (
		mimeType.startsWith("text/") ||
		mimeType === "application/json" ||
		mimeType.endsWith("+json") ||
		mimeType === "application/xml"
	);
}

function isValidMessage(msg: ModelMessage): boolean {
	if (typeof msg.content === "string") return msg.content.trim().length > 0;
	return Array.isArray(msg.content) && msg.content.length > 0;
}

/**
 * Splits the system prompt out of the conversation.
 *
 * VS Code sends its instructions as assistant messages before the first user message. They cannot
 * be turned into `system` role messages and left in `messages`: the AI SDK rejects system messages
 * in the `messages` field with "System messages are not allowed in the prompt or messages fields",
 * so they have to travel in the `instructions` option instead.
 *
 * With no user message there is nothing to instruct about, so the assistant messages are left as
 * conversation rather than draining `messages` empty.
 */
function extractInstructions(messages: ModelMessage[]): ConvertedMessages {
	const cutoff = Math.max(
		messages.findIndex((msg) => msg.role === "user"),
		0,
	);

	const instructionParts: string[] = [];
	const conversation: ModelMessage[] = [];

	messages.forEach((msg, index) => {
		// Instructions require string content; anything richer stays in the conversation.
		if (index < cutoff && msg.role === "assistant" && typeof msg.content === "string") {
			instructionParts.push(msg.content);
		} else {
			conversation.push(msg);
		}
	});

	return {
		messages: conversation,
		instructions: instructionParts.length > 0 ? instructionParts.join("\n\n") : undefined,
	};
}
