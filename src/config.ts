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
	return {
		endpoint: normalisedEndpoint(config.inspect<unknown>("endpoint")?.globalValue),
		timeout: boundedTimeout(config.get<unknown>("timeout", DEFAULT_TIMEOUT_MS)),
	};
}

// The Settings editor saves a cleared field as "", and settings.json can hold a value of any type.
function normalisedEndpoint(value: unknown): string {
	const endpoint = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
	return endpoint || DEFAULT_BASE_URL;
}

// settings.json only warns about a value outside the manifest's type and range, and VS Code returns it anyway.
function boundedTimeout(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
	return Math.min(Math.max(value, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}
