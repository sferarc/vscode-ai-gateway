import * as vscode from "vscode";
import type { AuthenticationMethod } from "./auth";
import { getConfig } from "./config";
import { MODELS_ENDPOINT } from "./constants";
import { extractErrorMessage, logger } from "./logger";
import { isChatModel } from "./models";

export interface DiagnosticsSession {
	accessToken: string;
	account: { label: string };
	method: AuthenticationMethod;
	oidcData?: { expiresAt: number };
}

interface ConnectionCheckResult {
	ok: boolean;
	endpoint: string;
	session?: { label: string; method: AuthenticationMethod; expiresAt?: number };
	status?: number;
	latencyMs?: number;
	modelCount?: number;
	chatModelCount?: number;
	credits?: { balance: string; totalUsed: string };
	error?: string;
}

const SHOW_LOGS = "Show Logs";
const CREDITS_ENDPOINT = "/v1/credits";

/**
 * Sends its own request so the result never comes from the models cache.
 * @internal Exported so tests can assert on the result without the notification UI.
 */
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
		result.chatModelCount = body.data.filter(
			(model: unknown) => typeof model === "object" && model !== null && isChatModel(model),
		).length;
		result.ok = true;
	} catch (error) {
		result.latencyMs ??= Date.now() - startTime;
		result.error = extractErrorMessage(error);
		return result;
	}
	result.credits = await fetchCredits(session.accessToken, endpoint, timeoutMs);
	return result;
}

// The balance is extra detail, so a failure here never fails the check.
async function fetchCredits(
	accessToken: string,
	endpoint: string,
	timeoutMs: number,
): Promise<ConnectionCheckResult["credits"]> {
	try {
		const response = await fetch(`${endpoint}${CREDITS_ENDPOINT}`, {
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) {
			logger.info(`Credit balance not available: HTTP ${response.status}`);
			return undefined;
		}
		const body = (await response.json()) as { balance?: unknown; total_used?: unknown } | null;
		const balance = creditAmount(body?.balance);
		const totalUsed = creditAmount(body?.total_used);
		if (balance === undefined || totalUsed === undefined) {
			logger.info("Credit balance not available: the response has no balance and total_used");
			return undefined;
		}
		return { balance, totalUsed };
	} catch (error) {
		logger.info(`Credit balance not available: ${extractErrorMessage(error)}`);
		return undefined;
	}
}

function creditAmount(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
		// The picker shows chat models only, so the total alone overstates what the user can pick.
		lines.push(`Chat models: ${result.chatModelCount ?? 0} of ${result.modelCount} listed`);
	}
	if (result.credits) {
		lines.push(`Credits: ${result.credits.balance} left, ${result.credits.totalUsed} used`);
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
