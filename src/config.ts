import * as vscode from "vscode";
import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, EXTENSION_ID } from "./constants";

export function getConfig() {
	const config = vscode.workspace.getConfiguration(EXTENSION_ID);
	// The endpoint receives the user's credentials, so a cloned repo's workspace settings must not redirect it.
	const endpoint = config.inspect<string>("endpoint")?.globalValue ?? DEFAULT_BASE_URL;
	return {
		endpoint: endpoint.replace(/\/+$/, ""),
		timeout: config.get("timeout", DEFAULT_TIMEOUT_MS),
	};
}
