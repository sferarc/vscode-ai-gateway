import * as vscode from "vscode";
import { VercelAIAuthenticationProvider } from "./auth";
import { EXTENSION_ID } from "./constants";
import { initializeLogger, logger } from "./logger";
import { VercelAIChatModelProvider } from "./provider";

export function activate(context: vscode.ExtensionContext) {
	const loggerDisposable = initializeLogger();
	context.subscriptions.push(loggerDisposable);

	logger.info("Vercel AI Gateway extension activating...");

	const authProvider = new VercelAIAuthenticationProvider(context);
	context.subscriptions.push(authProvider);

	const provider = new VercelAIChatModelProvider();
	context.subscriptions.push(provider);
	const providerDisposable = vscode.lm.registerLanguageModelChatProvider(EXTENSION_ID, provider);
	context.subscriptions.push(providerDisposable);

	const commandDisposable = vscode.commands.registerCommand(`${EXTENSION_ID}.manage`, () => {
		authProvider.manageAuthentication();
	});
	context.subscriptions.push(commandDisposable);

	logger.info("Vercel AI Gateway extension activated successfully");

	return { authProvider };
}

export function deactivate() {
	logger.info("Vercel AI Gateway extension deactivating...");
}
