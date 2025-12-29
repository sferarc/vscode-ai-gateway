import type { LanguageModelChatInformation } from "vscode";
import { BASE_URL, MODELS_CACHE_TTL_MS, MODELS_ENDPOINT } from "./constants";

export interface Model {
	id: string;
	object: string;
	created: number;
	owned_by: string;
	name: string;
	description: string;
	context_window: number;
	max_tokens: number;
	type: string;
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

export class ModelsClient {
	private modelsCache?: ModelsCache;

	async getModels(apiKey: string): Promise<LanguageModelChatInformation[]> {
		if (this.isModelsCacheFresh() && this.modelsCache) {
			return this.modelsCache.models;
		}

		const data = await this.fetchModels(apiKey);
		const models = this.transformToVSCodeModels(data);

		this.modelsCache = { fetchedAt: Date.now(), models };
		return models;
	}

	private async fetchModels(apiKey: string): Promise<Model[]> {
		const response = await fetch(`${BASE_URL}${MODELS_ENDPOINT}`, {
			headers: apiKey
				? {
						Authorization: `Bearer ${apiKey}`,
					}
				: {},
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
		return data.map((model) => ({
			id: model.id,
			name: model.name,
			family: model.owned_by,
			version: "1.0",
			maxInputTokens: model.context_window,
			maxOutputTokens: model.max_tokens,
			tooltip: model.description || "No description available.",
			capabilities: {
				imageInput: model.description?.toLowerCase().includes("image") || false,
				toolCalling: true,
			},
		}));
	}
}
