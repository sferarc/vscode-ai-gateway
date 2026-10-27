import type { LanguageModelChatInformation } from "vscode";
import { getConfig } from "./config";
import { MODELS_CACHE_TTL_MS, MODELS_ENDPOINT } from "./constants";
import { logger } from "./logger";
import { parseModelIdentity } from "./models/identity";

const IMAGE_INPUT_TAGS = new Set(["vision", "image", "image-input", "file-input", "multimodal"]);
const TOOL_CALLING_TAGS = new Set([
	"tool-use",
	"tool_use",
	"tool-calling",
	"function_calling",
	"function-calling",
	"function_call",
	"tools",
	"json_mode",
	"json-mode",
]);
const REASONING_TAGS = new Set(["reasoning", "o1", "o3", "extended-thinking", "extended_thinking"]);
const WEB_SEARCH_TAGS = new Set(["web-search", "web_search", "search", "grounding"]);

export interface Model {
	id: string;
	object: string;
	created: number;
	owned_by: string;
	name: string;
	description: string;
	context_window: number;
	max_tokens: number;
	type?: string;
	tags?: string[];
	/** Input/output modalities, e.g. `{ input: ["text", "image"] }`. */
	modalities?: {
		input?: string[];
		output?: string[];
	};
	/** Request parameters the model accepts, e.g. `["tools", "reasoning"]`. */
	supported_parameters?: string[];
	/** Present when the model exposes configurable reasoning. */
	reasoning_options?: { type: string }[];
	/** False for models that take no temperature, such as OpenAI's reasoning models. */
	temperature?: boolean;
	/** When the gateway deprecates the model, in milliseconds since the epoch, unlike `created`. */
	deprecated_at?: number;
	pricing: {
		input: string;
		output: string;
	};
}

const ERROR_BODY_LIMIT = 500;

/** A failed model-list request, carrying the HTTP status when the gateway answered. */
export class ModelsFetchError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "ModelsFetchError";
	}
}

async function readBody(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return "";
	}
}

function describeErrorBody(body: string): string {
	let detail = body.trim();
	try {
		const message = (JSON.parse(body) as { error?: { message?: unknown } })?.error?.message;
		if (typeof message === "string" && message) {
			detail = message;
		}
	} catch {
		// Not JSON; keep the raw text.
	}
	return detail.length > ERROR_BODY_LIMIT ? `${detail.slice(0, ERROR_BODY_LIMIT)}...` : detail;
}

interface ModelsCache {
	apiKey: string;
	fetchedAt: number;
	models: LanguageModelChatInformation[];
}

function hasTag(tags: string[], tagSet: Set<string>): boolean {
	return tags.some((tag) => tagSet.has(tag));
}

/**
 * Capability detection prefers the structured metadata the API returns and only falls back to
 * the tag heuristics when a field is absent, since keyword matching on tags is fragile.
 * A field that is present is authoritative, including when it says the capability is missing.
 */
function detectImageInput(model: Model, tags: string[]): boolean {
	const inputModalities = model.modalities?.input;
	if (inputModalities) {
		return inputModalities.includes("image");
	}
	return hasTag(tags, IMAGE_INPUT_TAGS);
}

function detectToolCalling(model: Model, tags: string[]): boolean {
	const supportedParameters = model.supported_parameters;
	if (supportedParameters) {
		return supportedParameters.includes("tools") || supportedParameters.includes("tool_choice");
	}
	return hasTag(tags, TOOL_CALLING_TAGS);
}

function detectReasoning(model: Model, tags: string[]): boolean {
	if (model.reasoning_options?.length) {
		return true;
	}
	const supportedParameters = model.supported_parameters;
	if (supportedParameters) {
		return (
			supportedParameters.includes("reasoning") || supportedParameters.includes("include_reasoning")
		);
	}
	return hasTag(tags, REASONING_TAGS);
}

function acceptsTemperature(model: Model): boolean {
	if (typeof model.temperature === "boolean") {
		return model.temperature;
	}
	return model.supported_parameters?.includes("temperature") ?? true;
}

// Observed in milliseconds while every other gateway timestamp is in seconds, so accept either.
function deprecationDate(model: Model): string | undefined {
	const value = model.deprecated_at;
	if (typeof value !== "number" || !(value > 0)) return undefined;
	const date = new Date(value < 1e12 ? value * 1000 : value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

/**
 * Splits the gateway's `context_window`, which covers input and output together, so that a prompt
 * filled to `maxInputTokens` still leaves room for `maxOutputTokens`. Many models report `max_tokens`
 * equal to the whole window, so the output share is capped at half of it.
 */
function splitContextWindow(
	contextWindow: number,
	maxTokens: number,
): { maxInputTokens: number; maxOutputTokens: number } {
	if (!(contextWindow > 0) || !(maxTokens > 0)) {
		return { maxInputTokens: contextWindow, maxOutputTokens: maxTokens };
	}
	const maxOutputTokens = Math.min(maxTokens, Math.floor(contextWindow / 2));
	return { maxInputTokens: contextWindow - maxOutputTokens, maxOutputTokens };
}

export class ModelsClient {
	private modelsCache?: ModelsCache;
	private inflightFetch?: { apiKey: string; promise: Promise<LanguageModelChatInformation[]> };
	private generation = 0;
	private temperatureUnsupported = new Set<string>();

	/** False only for a model the last fetched list marked as taking no temperature. */
	acceptsTemperature(modelId: string): boolean {
		return !this.temperatureUnsupported.has(modelId);
	}

	invalidateCache(): void {
		this.modelsCache = undefined;
		this.inflightFetch = undefined;
		this.generation++;
	}

	async getModels(apiKey: string): Promise<LanguageModelChatInformation[]> {
		const cache = this.modelsCache;
		if (cache && cache.apiKey === apiKey && Date.now() - cache.fetchedAt < MODELS_CACHE_TTL_MS) {
			return cache.models;
		}

		if (this.inflightFetch?.apiKey === apiKey) {
			return this.inflightFetch.promise;
		}

		const generation = this.generation;
		const promise = this.fetchAndTransform(apiKey)
			.then((models) => {
				// A fetch that outlived invalidateCache belongs to the previous session.
				if (generation === this.generation) {
					this.modelsCache = { apiKey, fetchedAt: Date.now(), models };
				}
				return models;
			})
			.catch((error: unknown) => {
				const stale = this.modelsCache;
				if (generation !== this.generation || stale?.apiKey !== apiKey) {
					throw error;
				}
				logger.warn(
					`Model list refresh failed, keeping the list fetched at ${new Date(stale.fetchedAt).toISOString()}`,
					error,
				);
				return stale.models;
			})
			.finally(() => {
				if (this.inflightFetch?.promise === promise) {
					this.inflightFetch = undefined;
				}
			});
		this.inflightFetch = { apiKey, promise };

		return promise;
	}

	private async fetchAndTransform(apiKey: string): Promise<LanguageModelChatInformation[]> {
		const { endpoint, timeout } = getConfig();
		const url = `${endpoint}${MODELS_ENDPOINT}`;

		const startTime = Date.now();
		logger.info(`Fetching models from ${url}`);

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeout);
		let data: Model[];
		try {
			data = await this.fetchModels(apiKey, url, controller.signal);
		} catch (error) {
			if (controller.signal.aborted) {
				throw new ModelsFetchError(`Timed out after ${timeout} ms waiting for ${url}`);
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}
		const models = this.transformToVSCodeModels(data);
		this.temperatureUnsupported = new Set(
			data.filter((model) => !acceptsTemperature(model)).map((model) => model.id),
		);

		logger.info(`Models fetched in ${Date.now() - startTime}ms, count: ${models.length}`);
		return models;
	}

	private async fetchModels(apiKey: string, url: string, signal: AbortSignal): Promise<Model[]> {
		const response = await fetch(url, {
			headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
			signal,
		});

		if (!response.ok) {
			const detail = describeErrorBody(await readBody(response));
			const statusLine = `HTTP ${response.status} ${response.statusText}`.trim();
			throw new ModelsFetchError(
				`${statusLine} from ${url}${detail ? `: ${detail}` : ""}`,
				response.status,
			);
		}

		let payload: unknown;
		try {
			payload = await response.json();
		} catch (error) {
			throw new ModelsFetchError(
				`Invalid JSON from ${url}: ${error instanceof Error ? error.message : String(error)}`,
				response.status,
			);
		}

		const data = (payload as { data?: unknown } | null)?.data;
		if (!Array.isArray(data)) {
			throw new ModelsFetchError(
				`Unexpected response from ${url}: expected a "data" array of models`,
				response.status,
			);
		}
		return data as Model[];
	}

	private transformToVSCodeModels(data: Model[]): LanguageModelChatInformation[] {
		return data
			.filter(
				(model) => model.type === "chat" || model.type === "language" || model.type === undefined,
			)
			.map((model) => {
				const identity = parseModelIdentity(model.id);
				const tags = (model.tags ?? []).map((tag) => tag.toLowerCase());
				const description = model.description || "No description available.";
				const deprecated = deprecationDate(model);

				return {
					id: model.id,
					name: model.name,
					detail: deprecated ? `Vercel AI Gateway, deprecated ${deprecated}` : "Vercel AI Gateway",
					family: identity.family,
					version: identity.version,
					...splitContextWindow(model.context_window, model.max_tokens),
					tooltip: deprecated
						? `${description}\n\nThe gateway marks this model as deprecated from ${deprecated}.`
						: description,
					capabilities: {
						imageInput: detectImageInput(model, tags),
						toolCalling: detectToolCalling(model, tags),
						reasoning: detectReasoning(model, tags),
						// No dedicated metadata field exists yet, so tags remain the only signal.
						webSearch: hasTag(tags, WEB_SEARCH_TAGS),
					},
				};
			});
	}
}
