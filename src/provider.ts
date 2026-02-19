import { createGatewayProvider } from "@ai-sdk/gateway";
import { jsonSchema, type ModelMessage, streamText, type TextStreamPart, type ToolSet } from "ai";
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

export function isValidMimeType(mimeType: string): boolean {
	return MIME_TYPE_PATTERN.test(mimeType);
}

export class VercelAIChatModelProvider implements LanguageModelChatProvider, vscode.Disposable {
	private modelsClient = new ModelsClient();
	private readonly modelInfoChangeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this.modelInfoChangeEmitter.event;

	dispose(): void {
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

			const response = streamText({
				model: gateway(model.id),
				messages: convertMessages(chatMessages),
				toolChoice,
				temperature: options.modelOptions?.temperature ?? 0.7,
				maxOutputTokens: options.modelOptions?.maxOutputTokens ?? 4096,
				tools: Object.keys(tools).length > 0 ? tools : undefined,
				abortSignal: abortController.signal,
				timeout: config.timeout,
			});

			for await (const chunk of response.fullStream) {
				const emitted = this.handleStreamChunk(chunk, progress);
				if (emitted) responseSent = true;
			}

			if (!responseSent) {
				logger.error("Stream completed with no content");
				progress.report(new LanguageModelTextPart("**Error**: No response received from model."));
			}

			logger.info(`Chat request completed for ${model.id}`);
		} catch (error) {
			if (this.isAbortError(error)) {
				logger.debug("Request was cancelled");
				return;
			}

			logger.error("Exception during streaming:", error);
			const errorMessage = extractErrorMessage(error);
			progress.report(new LanguageModelTextPart(`\n\n**Error:** ${errorMessage}\n\n`));
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

	private isAbortError(error: unknown): boolean {
		if (!(error instanceof Error)) return false;
		return (
			error.name === "AbortError" ||
			error.message.includes("aborted") ||
			error.message.includes("cancelled") ||
			error.message.includes("canceled")
		);
	}

	private async getApiKey(silent: boolean): Promise<string | undefined> {
		try {
			const session = await authentication.getSession(VERCEL_AI_AUTH_PROVIDER_ID, [], {
				createIfNone: !silent,
				silent,
			});
			return session?.accessToken;
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

export function convertMessages(messages: readonly LanguageModelChatMessage[]): ModelMessage[] {
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

	fixSystemMessages(result);
	return result;
}

export function convertSingleMessage(
	msg: LanguageModelChatMessage,
	toolNameMap: Record<string, string>,
): ModelMessage[] {
	const results: ModelMessage[] = [];
	const role = msg.role === LanguageModelChatMessageRole.User ? "user" : "assistant";
	const contentParts: Array<{ type: string; text?: string; image?: string }> = [];

	for (const part of msg.content) {
		if (typeof part !== "object" || part === null) continue;

		if (isTextPart(part)) {
			contentParts.push({ type: "text", text: part.value });
		} else if (part instanceof LanguageModelDataPart) {
			if (part.mimeType.startsWith("image/")) {
				const base64 = Buffer.from(part.data).toString("base64");
				contentParts.push({ type: "image", image: `data:${part.mimeType};base64,${base64}` });
			} else {
				contentParts.push({ type: "text", text: new TextDecoder().decode(part.data) });
			}
		} else if (part instanceof LanguageModelToolCallPart) {
			if (contentParts.length > 0) {
				results.push(createMessage(role, contentParts));
				contentParts.length = 0;
			}
			results.push({
				role: "assistant",
				content: [
					{ type: "tool-call", toolName: part.name, toolCallId: part.callId, input: part.input },
				],
			});
		} else if (part instanceof LanguageModelToolResultPart) {
			if (contentParts.length > 0) {
				results.push(createMessage(role, contentParts));
				contentParts.length = 0;
			}
			const texts = extractToolResultTexts(part);
			if (texts.length > 0) {
				const toolName = toolNameMap[part.callId] ?? "unknown_tool";
				if (toolName === "unknown_tool") {
					logger.warn(`Tool result references unknown callId: ${part.callId}`);
				}
				results.push({
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: part.callId,
							toolName,
							output: { type: "text", value: texts.join(" ") },
						},
					],
				});
			}
		}
	}

	if (contentParts.length > 0) {
		results.push(createMessage(role, contentParts));
	}

	if (results.length === 0) {
		results.push({ role, content: "" });
	}

	return results;
}

function createMessage(
	role: "user" | "assistant",
	parts: Array<{ type: string; text?: string; image?: string }>,
): ModelMessage {
	const textOnly = parts.every((p) => p.type === "text");
	if (textOnly) {
		return { role, content: parts.map((p) => p.text).join("") };
	}

	if (role === "user") {
		return {
			role: "user",
			content: parts.map((p) =>
				p.type === "text"
					? { type: "text" as const, text: p.text ?? "" }
					: { type: "image" as const, image: p.image ?? "" },
			),
		};
	}

	return { role, content: parts.map((p) => (p.type === "text" ? p.text : "[Image]")).join("") };
}

function isTextPart(part: object): part is { value: string } {
	return "value" in part && typeof (part as { value: unknown }).value === "string";
}

function extractToolResultTexts(part: LanguageModelToolResultPart): string[] {
	return part.content
		.filter((p): p is { value: string } => typeof p === "object" && p !== null && "value" in p)
		.map((p) => p.value);
}

function isValidMessage(msg: ModelMessage): boolean {
	if (typeof msg.content === "string") return msg.content.trim().length > 0;
	return Array.isArray(msg.content) && msg.content.length > 0;
}

function fixSystemMessages(result: ModelMessage[]): void {
	const firstUserIndex = result.findIndex((msg) => msg.role === "user");
	for (let i = 0; i < firstUserIndex; i++) {
		const msg = result[i];
		// Only convert to system if content is a string (SystemModelMessage requires string content)
		if (msg.role === "assistant" && typeof msg.content === "string") {
			result[i] = { role: "system", content: msg.content };
		}
	}
}
