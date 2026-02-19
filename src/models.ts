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

export class ModelsClient {
	private modelsCache?: ModelsCache;
	private inflightFetch?: Promise<LanguageModelChatInformation[]>;

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
						imageInput: hasTag(tags, IMAGE_INPUT_TAGS),
						toolCalling: hasTag(tags, TOOL_CALLING_TAGS),
						reasoning: hasTag(tags, REASONING_TAGS),
						webSearch: hasTag(tags, WEB_SEARCH_TAGS),
					},
				};
			});
	}
}
