import * as vscode from "vscode";
import { getConfig } from "./config";
import { fetchCredits } from "./diagnostics";
import { extractErrorMessage, logger } from "./logger";
import { type ModelsClient, ModelsFetchError } from "./models";

export interface StatusToolInput {
	modelIds?: unknown;
	search?: unknown;
}

interface StatusSession {
	accessToken: string;
}

// Matches the manifest's maxItems and caps search results, so a model cannot ask for the whole catalogue.
const MAX_MODEL_IDS = 20;
const TOP_SPEND_MODELS = 3;
const REPORT_ENDPOINT = "/v1/report";

const SPEND_FORMAT = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 4,
});

interface MonthSpend {
	since: string;
	totalCost: number;
	requestCount?: number;
	topModels: { model: string; totalCost: number }[];
}

const SIGN_IN =
	"Ask the user to run Vercel AI Gateway: Manage Authentication to add an API key or sign in with Vercel OIDC.";
const CHECK_CONNECTION = "Ask the user to run Vercel AI Gateway: Check Connection to see why.";

/** Read-only agent tool: the active session's credit balance, this month's spend and the price of the models it names. */
export class StatusTool implements vscode.LanguageModelTool<StatusToolInput> {
	constructor(
		private readonly getActiveSession: () => Promise<StatusSession | null>,
		private readonly modelsClient: ModelsClient,
	) {}

	prepareInvocation(): vscode.PreparedToolInvocation {
		return { invocationMessage: "Reading Vercel AI Gateway credits, spend and model prices" };
	}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<StatusToolInput>,
	): Promise<vscode.LanguageModelToolResult> {
		const text = await this.report(
			requestedIds(options.input?.modelIds),
			searchTerm(options.input?.search),
		);
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
	}

	private async report(modelIds: string[], search: string | undefined): Promise<string> {
		let session: StatusSession | null;
		try {
			session = await this.getActiveSession();
		} catch (error) {
			logger.error("Status tool could not read the active session", error);
			return `Could not read the Vercel AI Gateway session: ${extractErrorMessage(error)}. ${SIGN_IN}`;
		}
		if (!session) {
			return `Not signed in to Vercel AI Gateway. ${SIGN_IN}`;
		}

		const { endpoint, timeout } = getConfig();
		const [credits, spend, models] = await Promise.all([
			fetchCredits(session.accessToken, endpoint, timeout),
			fetchMonthSpend(session.accessToken, endpoint, timeout),
			this.describeModels(session.accessToken, modelIds, search),
		]);
		const creditLine = credits
			? `Credits: ${credits.balance} left, ${credits.totalUsed} used.`
			: `Credits: the gateway did not return a balance. ${CHECK_CONNECTION}`;
		return [creditLine, describeSpend(spend), ...models].join("\n");
	}

	private async describeModels(
		accessToken: string,
		modelIds: string[],
		search: string | undefined,
	): Promise<string[]> {
		let models: vscode.LanguageModelChatInformation[];
		try {
			models = await this.modelsClient.getModels(accessToken);
		} catch (error) {
			logger.error("Status tool could not load the model list", error);
			const status = error instanceof ModelsFetchError ? error.status : undefined;
			return status === 401 || status === 403
				? [`Models: the gateway rejected the session's credentials. ${SIGN_IN}`]
				: [`Models: the model list could not be loaded. ${CHECK_CONNECTION}`];
		}
		if (modelIds.length === 0 && search === undefined) {
			return [
				`Models: ${models.length} chat models available. Pass search to find ids, or ids in modelIds, for prices and context windows.`,
			];
		}
		const found = search === undefined ? [] : this.searchModels(models, search);
		const byId = new Map(models.map((model) => [model.id, model]));
		const requested = modelIds.map((id) => {
			const model = byId.get(id);
			return model
				? describeModel(model, this.modelsClient)
				: `- ${id}: not in the gateway's chat model list.`;
		});
		return [...found, ...requested];
	}

	private searchModels(models: vscode.LanguageModelChatInformation[], search: string): string[] {
		const term = search.toLowerCase();
		const matches = models.filter(
			(model) => model.id.toLowerCase().includes(term) || model.name.toLowerCase().includes(term),
		);
		if (matches.length === 0) {
			return [`Models matching "${search}": none of the ${models.length} chat models.`];
		}
		const header =
			matches.length > MAX_MODEL_IDS
				? `Models matching "${search}": ${matches.length}, showing the first ${MAX_MODEL_IDS}. Use a longer search term to narrow them.`
				: `Models matching "${search}": ${matches.length}.`;
		return [
			header,
			...matches.slice(0, MAX_MODEL_IDS).map((model) => describeModel(model, this.modelsClient)),
		];
	}
}

/** Spend from the first of the month (UTC) to today by model; undefined when unreadable, so it never fails the tool. */
async function fetchMonthSpend(
	accessToken: string,
	endpoint: string,
	timeoutMs: number,
): Promise<MonthSpend | undefined> {
	const today = new Date().toISOString().slice(0, 10);
	const since = `${today.slice(0, 8)}01`;
	const query = new URLSearchParams({ start_date: since, end_date: today, group_by: "model" });
	try {
		const response = await fetch(`${endpoint}${REPORT_ENDPOINT}?${query}`, {
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) {
			logger.info(`Spend report not available: HTTP ${response.status}`);
			return undefined;
		}
		const body = (await response.json()) as { results?: unknown } | null;
		if (!Array.isArray(body?.results)) {
			logger.info("Spend report not available: the response has no results");
			return undefined;
		}
		return summariseSpend(since, body.results);
	} catch (error) {
		logger.info(`Spend report not available: ${extractErrorMessage(error)}`);
		return undefined;
	}
}

function summariseSpend(since: string, rows: unknown[]): MonthSpend {
	let totalCost = 0;
	let requestCount: number | undefined;
	const byModel: MonthSpend["topModels"] = [];
	for (const row of rows) {
		if (typeof row !== "object" || row === null) continue;
		const { model, total_cost, request_count } = row as Record<string, unknown>;
		if (typeof total_cost !== "number" || !Number.isFinite(total_cost)) continue;
		totalCost += total_cost;
		if (typeof request_count === "number" && Number.isFinite(request_count)) {
			requestCount = (requestCount ?? 0) + request_count;
		}
		if (typeof model === "string" && model && total_cost > 0) {
			byModel.push({ model, totalCost: total_cost });
		}
	}
	byModel.sort((a, b) => b.totalCost - a.totalCost);
	return { since, totalCost, requestCount, topModels: byModel.slice(0, TOP_SPEND_MODELS) };
}

function describeSpend(spend: MonthSpend | undefined): string {
	if (!spend) {
		return "Spend this month: the gateway did not return a spend report for this session.";
	}
	const header = `Spend this month (since ${spend.since} UTC): ${SPEND_FORMAT.format(spend.totalCost)}`;
	const requests = spend.requestCount === undefined ? "" : ` over ${spend.requestCount} requests`;
	if (spend.topModels.length === 0) return `${header}${requests}.`;
	const top = spend.topModels
		.map(({ model, totalCost }) => `${model} ${SPEND_FORMAT.format(totalCost)}`)
		.join(", ");
	return `${header}${requests}. Most spent on: ${top}.`;
}

function requestedIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const ids = value
		.filter((id): id is string => typeof id === "string")
		.map((id) => id.trim())
		.filter(Boolean);
	return [...new Set(ids)].slice(0, MAX_MODEL_IDS);
}

function searchTerm(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return value.trim() || undefined;
}

function describeModel(
	model: vscode.LanguageModelChatInformation,
	modelsClient: ModelsClient,
): string {
	const price = modelsClient.priceOf(model.id);
	const input = price?.input ? `${price.input} per million input tokens` : "input price not listed";
	const output = price?.output
		? `${price.output} per million output tokens`
		: "output price not listed";
	const contextWindow = model.maxInputTokens + model.maxOutputTokens;
	const context =
		contextWindow > 0
			? `context window ${contextWindow} tokens, up to ${model.maxOutputTokens} output`
			: "context window not listed";
	return `- ${model.id} (${model.name}): ${input}, ${output}; ${context}.`;
}
