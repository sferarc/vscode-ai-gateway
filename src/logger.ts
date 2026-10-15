/**
 * Logging utilities for the Vercel AI Gateway extension.
 *
 * Uses VS Code's native LogOutputChannel for structured logging.
 */

import * as vscode from "vscode";

let _logChannel: vscode.LogOutputChannel | null = null;

/**
 * Initialize the shared log output channel.
 * Call this ONCE from extension activate().
 */
export function initializeLogger(): vscode.Disposable {
	if (_logChannel) {
		return { dispose: () => {} };
	}

	try {
		_logChannel = vscode.window.createOutputChannel("Vercel AI Gateway", { log: true });
	} catch {
		return { dispose: () => {} };
	}

	return {
		dispose: () => {
			_logChannel?.dispose();
			_logChannel = null;
		},
	};
}

/**
 * Reset the logger singleton (for testing only).
 * @internal
 */
export function _resetLoggerForTesting(): void {
	_logChannel?.dispose();
	_logChannel = null;
}

export const logger = {
	error(message: string, ...args: unknown[]): void {
		_logChannel?.error(message, ...args);
	},
	warn(message: string, ...args: unknown[]): void {
		_logChannel?.warn(message, ...args);
	},
	info(message: string, ...args: unknown[]): void {
		_logChannel?.info(message, ...args);
	},
	debug(message: string, ...args: unknown[]): void {
		_logChannel?.debug(message, ...args);
	},
};

/**
 * Extract a user-friendly error message from various error types.
 */
export function extractErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const causes = describeCauseChain(error);
		return causes.length > 0 ? `${error.message} (${causes.join(": ")})` : error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	if (error && typeof error === "object" && "message" in error) {
		return String((error as { message: unknown }).message);
	}
	return "An unexpected error occurred";
}

const MAX_CAUSE_DEPTH = 3;

// Node's fetch rejects with TypeError("fetch failed") and keeps the real reason in `cause`.
function describeCauseChain(error: Error): string[] {
	const parts: string[] = [];
	const seen = new Set<unknown>([error]);
	let cause: unknown = error.cause;
	while (parts.length < MAX_CAUSE_DEPTH && cause != null && !seen.has(cause)) {
		seen.add(cause);
		const part = describeCause(cause);
		if (part && part !== error.message && !parts.includes(part)) {
			parts.push(part);
		}
		cause = typeof cause === "object" && "cause" in cause ? cause.cause : undefined;
	}
	return parts;
}

function describeCause(cause: unknown): string | undefined {
	if (typeof cause === "string") {
		return cause || undefined;
	}
	if (typeof cause !== "object" || cause === null) {
		return undefined;
	}
	const message = "message" in cause && typeof cause.message === "string" ? cause.message : "";
	const code = "code" in cause && typeof cause.code === "string" ? cause.code : "";
	if (code && !message.includes(code)) {
		return message ? `${message} [${code}]` : code;
	}
	return message || undefined;
}
