import { extractErrorMessage, logger } from "./logger";

export interface LastChatRequest {
	generationId: string;
	/** The model the request asked for; the gateway may have served a fallback. */
	model: string;
}

/** In memory only, so the record ends with the VS Code window. */
export class LastChatRequestStore {
	private last: LastChatRequest | undefined;

	record(request: LastChatRequest): void {
		this.last = request;
	}

	get(): LastChatRequest | undefined {
		return this.last;
	}
}

export interface GenerationCost {
	model: string;
	providerName: string;
	totalCost: number;
	isByok: boolean;
	promptTokens?: number;
	cachedTokens?: number;
	cacheCreationTokens?: number;
	completionTokens?: number;
	reasoningTokens?: number;
}

const GENERATION_ENDPOINT = "/v1/generation";

const COST_FORMAT = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 6,
});

/** The gateway's record of one generation; undefined when unreadable, so it never fails the caller. */
export async function fetchGenerationCost(
	accessToken: string,
	endpoint: string,
	timeoutMs: number,
	generationId: string,
): Promise<GenerationCost | undefined> {
	const query = new URLSearchParams({ id: generationId });
	try {
		const response = await fetch(`${endpoint}${GENERATION_ENDPOINT}?${query}`, {
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) {
			logger.info(`Generation ${generationId} not available: HTTP ${response.status}`);
			return undefined;
		}
		const body = (await response.json()) as { data?: unknown } | null;
		const cost = parseGeneration(body?.data);
		if (!cost) {
			logger.info(`Generation ${generationId} not available: the response has no cost`);
		}
		return cost;
	} catch (error) {
		logger.info(`Generation ${generationId} not available: ${extractErrorMessage(error)}`);
		return undefined;
	}
}

function parseGeneration(data: unknown): GenerationCost | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const row = data as Record<string, unknown>;
	const totalCost = finiteNumber(row.total_cost);
	if (totalCost === undefined) return undefined;
	return {
		model: typeof row.model === "string" ? row.model : "",
		providerName: typeof row.provider_name === "string" ? row.provider_name : "",
		totalCost,
		isByok: row.is_byok === true,
		promptTokens: finiteNumber(row.native_tokens_prompt),
		cachedTokens: finiteNumber(row.native_tokens_cached),
		cacheCreationTokens: finiteNumber(row.native_tokens_cache_creation),
		completionTokens: finiteNumber(row.native_tokens_completion),
		reasoningTokens: finiteNumber(row.native_tokens_reasoning),
	};
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function describeLastRequest(
	request: LastChatRequest,
	cost: GenerationCost | undefined,
): string {
	if (!cost) {
		return `Last chat request: ${request.model}, generation ${request.generationId}; the gateway did not return its cost.`;
	}
	const model = cost.model || request.model;
	const provider = cost.providerName ? ` served by ${cost.providerName}` : "";
	const byok = cost.isByok ? " with the team's own provider key" : "";
	const tokens = [
		cost.promptTokens !== undefined && `${cost.promptTokens} input tokens`,
		cost.cachedTokens && `${cost.cachedTokens} cache read`,
		cost.cacheCreationTokens && `${cost.cacheCreationTokens} cache write`,
		cost.completionTokens !== undefined && `${cost.completionTokens} output tokens`,
		cost.reasoningTokens && `${cost.reasoningTokens} reasoning`,
	].filter((part): part is string => typeof part === "string");
	const counts = tokens.length > 0 ? `; ${tokens.join(", ")}` : "";
	return `Last chat request: ${model}${provider}${byok}, cost ${COST_FORMAT.format(cost.totalCost)}${counts}.`;
}
