import * as vscode from "vscode";
import { getConfig } from "./config";
import { fetchCredits } from "./diagnostics";
import { extractErrorMessage, logger } from "./logger";
import { type ModelsClient, ModelsFetchError } from "./models";

export interface StatusToolInput {
	modelIds?: unknown;
}

interface StatusSession {
	accessToken: string;
}

// Matches the manifest's maxItems, so a model cannot ask for the whole catalogue.
const MAX_MODEL_IDS = 20;

const SIGN_IN =
	"Ask the user to run Vercel AI Gateway: Manage Authentication to add an API key or sign in with Vercel OIDC.";
const CHECK_CONNECTION = "Ask the user to run Vercel AI Gateway: Check Connection to see why.";

/** Read-only agent tool: the active session's credit balance and the price of the models it names. */
export class StatusTool implements vscode.LanguageModelTool<StatusToolInput> {
	constructor(
		private readonly getActiveSession: () => Promise<StatusSession | null>,
		private readonly modelsClient: ModelsClient,
	) {}

	prepareInvocation(): vscode.PreparedToolInvocation {
		return { invocationMessage: "Reading Vercel AI Gateway credits and model prices" };
	}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<StatusToolInput>,
	): Promise<vscode.LanguageModelToolResult> {
		const text = await this.report(requestedIds(options.input?.modelIds));
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
	}

	private async report(modelIds: string[]): Promise<string> {
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
		const [credits, models] = await Promise.all([
			fetchCredits(session.accessToken, endpoint, timeout),
			this.describeModels(session.accessToken, modelIds),
		]);
		const creditLine = credits
			? `Credits: ${credits.balance} left, ${credits.totalUsed} used.`
			: `Credits: the gateway did not return a balance. ${CHECK_CONNECTION}`;
		return [creditLine, ...models].join("\n");
	}

	private async describeModels(accessToken: string, modelIds: string[]): Promise<string[]> {
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
		if (modelIds.length === 0) {
			return [
				`Models: ${models.length} chat models available. Pass their ids in modelIds for prices and context windows.`,
			];
		}
		const byId = new Map(models.map((model) => [model.id, model]));
		return modelIds.map((id) => {
			const model = byId.get(id);
			return model
				? describeModel(model, this.modelsClient)
				: `- ${id}: not in the gateway's chat model list.`;
		});
	}
}

function requestedIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const ids = value
		.filter((id): id is string => typeof id === "string")
		.map((id) => id.trim())
		.filter(Boolean);
	return [...new Set(ids)].slice(0, MAX_MODEL_IDS);
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
