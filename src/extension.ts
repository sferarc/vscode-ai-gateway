import * as vscode from "vscode";
import { VercelAIAuthenticationProvider } from "./auth";
import { EXTENSION_ID, STATUS_TOOL_NAME } from "./constants";
import { runConnectionCheck } from "./diagnostics";
import { LastChatRequestStore } from "./last-request";
import { initializeLogger, logger } from "./logger";
import { ModelsClient } from "./models";
import { VercelAIChatModelProvider } from "./provider";
import { manageProviderKeys, ProviderKeyStore } from "./provider-keys";
import { StatusTool } from "./tools";

export function activate(context: vscode.ExtensionContext) {
	const loggerDisposable = initializeLogger();
	context.subscriptions.push(loggerDisposable);

	logger.info("Vercel AI Gateway extension activating...");

	const authProvider = new VercelAIAuthenticationProvider(context);
	context.subscriptions.push(authProvider, authProvider.watchSignedInContext());

	const getActiveSession = () => authProvider.getActiveSession();
	const modelsClient = new ModelsClient();
	const lastRequest = new LastChatRequestStore();
	const providerKeys = new ProviderKeyStore(context.secrets);
	const provider = new VercelAIChatModelProvider(
		getActiveSession,
		modelsClient,
		lastRequest,
		providerKeys,
	);
	context.subscriptions.push(provider);
	const providerDisposable = vscode.lm.registerLanguageModelChatProvider(EXTENSION_ID, provider);
	context.subscriptions.push(providerDisposable);
	context.subscriptions.push(
		vscode.lm.registerTool(
			STATUS_TOOL_NAME,
			new StatusTool(getActiveSession, modelsClient, lastRequest),
		),
	);

	const commandDisposable = vscode.commands.registerCommand(`${EXTENSION_ID}.manage`, () => {
		authProvider.manageAuthentication();
	});
	context.subscriptions.push(commandDisposable);
	context.subscriptions.push(
		vscode.commands.registerCommand(`${EXTENSION_ID}.checkConnection`, () =>
			runConnectionCheck(getActiveSession),
		),
		vscode.commands.registerCommand(`${EXTENSION_ID}.showLogs`, () => logger.show()),
		vscode.commands.registerCommand(`${EXTENSION_ID}.manageProviderKeys`, () =>
			manageProviderKeys(providerKeys),
		),
	);

	logger.info("Vercel AI Gateway extension activated successfully");
}

export function deactivate() {
	logger.info("Vercel AI Gateway extension deactivating...");
}
