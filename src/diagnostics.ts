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
	spend?: MonthSpend;
	error?: string;
}

export interface MonthSpend {
	since: string;
	totalCost: number;
	requestCount?: number;
	topModels: { model: string; totalCost: number }[];
}

const SHOW_LOGS = "Show Logs";
const CREDITS_ENDPOINT = "/v1/credits";
const REPORT_ENDPOINT = "/v1/report";
const TOP_SPEND_MODELS = 3;

const SPEND_FORMAT = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 4,
});

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
	[result.credits, result.spend] = await Promise.all([
		fetchCredits(session.accessToken, endpoint, timeoutMs),
		fetchMonthSpend(session.accessToken, endpoint, timeoutMs),
	]);
	return result;
}

/** Undefined when the balance cannot be read, so a failure here never fails the check. */
export async function fetchCredits(
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

/** Spend from the first of the month (UTC) to today by model; undefined when unreadable, so it never fails the caller. */
export async function fetchMonthSpend(
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

export function describeMonthSpend(spend: MonthSpend): string {
	const header = `Spend this month (since ${spend.since} UTC): ${SPEND_FORMAT.format(spend.totalCost)}`;
	const requests = spend.requestCount === undefined ? "" : ` over ${spend.requestCount} requests`;
	if (spend.topModels.length === 0) return `${header}${requests}.`;
	const top = spend.topModels
		.map(({ model, totalCost }) => `${model} ${SPEND_FORMAT.format(totalCost)}`)
		.join(", ");
	return `${header}${requests}. Most spent on: ${top}.`;
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
	if (result.spend) {
		lines.push(describeMonthSpend(result.spend));
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
