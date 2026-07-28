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
	pricing: {
		input: string;
		output: string;
	};
}

interface ModelsResponse {
	data: Model[];
}

interface ModelsCache {
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

export class ModelsClient {
	private modelsCache?: ModelsCache;
	private inflightFetch?: Promise<LanguageModelChatInformation[]>;

	invalidateCache(): void {
		this.modelsCache = undefined;
	}

	async getModels(apiKey: string): Promise<LanguageModelChatInformation[]> {
		if (this.isModelsCacheFresh() && this.modelsCache) {
			return this.modelsCache.models;
		}

		if (this.inflightFetch) {
			return this.inflightFetch;
		}

		this.inflightFetch = this.fetchAndTransform(apiKey).finally(() => {
			this.inflightFetch = undefined;
		});

		return this.inflightFetch;
	}

	private async fetchAndTransform(apiKey: string): Promise<LanguageModelChatInformation[]> {
		const { endpoint } = getConfig();
		const url = `${endpoint}${MODELS_ENDPOINT}`;

		const startTime = Date.now();
		logger.info(`Fetching models from ${url}`);

		const data = await this.fetchModels(apiKey, url);
		const models = this.transformToVSCodeModels(data);

		logger.info(`Models fetched in ${Date.now() - startTime}ms, count: ${models.length}`);
		this.modelsCache = { fetchedAt: Date.now(), models };
		return models;
	}

	private async fetchModels(apiKey: string, url: string): Promise<Model[]> {
		const response = await fetch(url, {
			headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const { data } = (await response.json()) as ModelsResponse;
		return data;
	}

	private isModelsCacheFresh(): boolean {
		return Boolean(
			this.modelsCache && Date.now() - this.modelsCache.fetchedAt < MODELS_CACHE_TTL_MS,
		);
	}

	private transformToVSCodeModels(data: Model[]): LanguageModelChatInformation[] {
		return data
			.filter(
				(model) => model.type === "chat" || model.type === "language" || model.type === undefined,
			)
			.map((model) => {
				const identity = parseModelIdentity(model.id);
				const tags = (model.tags ?? []).map((tag) => tag.toLowerCase());

				return {
					id: model.id,
					name: model.name,
					detail: "Vercel AI Gateway",
					family: identity.family,
					version: identity.version,
					maxInputTokens: model.context_window,
					maxOutputTokens: model.max_tokens,
					tooltip: model.description || "No description available.",
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
