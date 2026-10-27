import * as vscode from "vscode";
import {
	DEFAULT_BASE_URL,
	DEFAULT_TIMEOUT_MS,
	EXTENSION_ID,
	MAX_TIMEOUT_MS,
	MIN_TIMEOUT_MS,
} from "./constants";

export function getConfig() {
	const config = vscode.workspace.getConfiguration(EXTENSION_ID);
	// The endpoint receives the user's credentials, so a cloned repo's workspace settings must not redirect it.
	const endpoint = config.inspect<string>("endpoint")?.globalValue ?? DEFAULT_BASE_URL;
	return {
		endpoint: endpoint.replace(/\/+$/, ""),
		timeout: boundedTimeout(config.get<unknown>("timeout", DEFAULT_TIMEOUT_MS)),
	};
}

// settings.json only warns about a value outside the manifest's type and range, and VS Code returns it anyway.
function boundedTimeout(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
	return Math.min(Math.max(value, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}
