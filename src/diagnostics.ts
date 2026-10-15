import * as vscode from "vscode";
import type { AuthenticationMethod } from "./auth";
import { getConfig } from "./config";
import { MODELS_ENDPOINT } from "./constants";
import { extractErrorMessage, logger } from "./logger";

export interface DiagnosticsSession {
	accessToken: string;
	account: { label: string };
	method: AuthenticationMethod;
	oidcData?: { expiresAt: number };
}

export interface ConnectionCheckResult {
	ok: boolean;
	endpoint: string;
	session?: { label: string; method: AuthenticationMethod; expiresAt?: number };
	status?: number;
	latencyMs?: number;
	modelCount?: number;
	error?: string;
}

const SHOW_LOGS = "Show Logs";

/** Sends its own request so the result never comes from the models cache. */
export async function checkConnection(
	session: DiagnosticsSession | null,
	endpoint: string,
	timeoutMs: number,
): Promise<ConnectionCheckResult> {
	if (!session) {
		return {
			ok: false,
			endpoint,
			error: "No active session. Run Vercel AI Gateway: Manage Authentication to add one.",
		};
	}

	const result: ConnectionCheckResult = {
		ok: false,
		endpoint,
		session: {
			label: session.account.label,
			method: session.method,
			expiresAt: session.oidcData?.expiresAt,
		},
	};

	const startTime = Date.now();
	try {
		const response = await fetch(`${endpoint}${MODELS_ENDPOINT}`, {
			headers: { Authorization: `Bearer ${session.accessToken}` },
			signal: AbortSignal.timeout(timeoutMs),
		});
		result.latencyMs = Date.now() - startTime;
		result.status = response.status;
		if (!response.ok) {
			result.error =
				response.status === 401 || response.status === 403
					? "The gateway rejected the session's credentials. Sign in again or replace the API key."
					: response.statusText || "The gateway returned an error";
			return result;
		}
		const body = (await response.json()) as { data?: unknown };
		if (!Array.isArray(body.data)) {
			result.error = "The response has no model list";
			return result;
		}
		result.modelCount = body.data.length;
		result.ok = true;
	} catch (error) {
		result.latencyMs ??= Date.now() - startTime;
		result.error = extractErrorMessage(error);
	}
	return result;
}

function formatConnectionCheck(result: ConnectionCheckResult): string[] {
	const lines = [`Endpoint: ${result.endpoint}`];
	if (result.session) {
		lines.push(`Session: ${result.session.label} (${result.session.method})`);
		if (result.session.expiresAt !== undefined) {
			lines.push(`OIDC token expires: ${new Date(result.session.expiresAt).toISOString()}`);
		}
	}
	if (result.status !== undefined) {
		lines.push(`HTTP status: ${result.status}`);
	}
	if (result.latencyMs !== undefined) {
		lines.push(`Latency: ${result.latencyMs}ms`);
	}
	if (result.modelCount !== undefined) {
		lines.push(`Models: ${result.modelCount}`);
	}
	if (result.error) {
		lines.push(`Error: ${result.error}`);
	}
	return lines;
}

export async function runConnectionCheck(
	getActiveSession: () => Promise<DiagnosticsSession | null>,
): Promise<void> {
	const { endpoint, timeout } = getConfig();
	let result: ConnectionCheckResult;
	try {
		result = await checkConnection(await getActiveSession(), endpoint, timeout);
	} catch (error) {
		result = {
			ok: false,
			endpoint,
			error: `Could not read the active session: ${extractErrorMessage(error)}`,
		};
	}
	const lines = formatConnectionCheck(result);
	logger.info(`Check Connection ${result.ok ? "succeeded" : "failed"}: ${lines.join("; ")}`);

	const heading = result.ok
		? "Connected to Vercel AI Gateway."
		: "Vercel AI Gateway connection check failed.";
	const message = `${heading} ${lines.map((line) => line.replace(/\.$/, "")).join(". ")}.`;
	const choice = result.ok
		? await vscode.window.showInformationMessage(message, SHOW_LOGS)
		: await vscode.window.showErrorMessage(message, SHOW_LOGS);
	if (choice === SHOW_LOGS) {
		logger.show();
	}
}
