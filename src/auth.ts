import {
	type AuthenticationProvider,
	type AuthenticationProviderAuthenticationSessionsChangeEvent,
	type AuthenticationProviderSessionOptions,
	type AuthenticationSession,
	authentication,
	type Disposable,
	type Event,
	EventEmitter,
	type ExtensionContext,
	window,
} from "vscode";
import { ERROR_MESSAGES, EXTENSION_ID } from "./constants";
import { AuthCancelledError } from "./errors";
import { logger } from "./logger";
import {
	checkVercelCliAvailable,
	createInteractiveOidcSession,
	refreshOidcToken,
} from "./vercel-auth";

export const VERCEL_AI_AUTH_PROVIDER_ID = EXTENSION_ID;

const SESSIONS_SECRET_KEY = `${VERCEL_AI_AUTH_PROVIDER_ID}.sessions`;
const ACTIVE_SESSION_KEY = `${VERCEL_AI_AUTH_PROVIDER_ID}.activeSession`;

/**
 * Sessions used to share one of these ids across every account, which made accounts
 * indistinguishable to VS Code. They are rewritten to the session id on read.
 */
const LEGACY_ACCOUNT_IDS = new Set(["vercel-ai-user", "vercel-oidc-user"]);

export type AuthenticationMethod = "api-key" | "oidc";

interface SessionData {
	id: string;
	accessToken: string;
	account: { id: string; label: string };
	scopes: readonly string[];
	method: AuthenticationMethod;
	oidcData?: {
		projectId: string;
		projectName: string;
		teamId?: string;
		teamName?: string;
		expiresAt: number;
	};
}

function isStoredSession(value: unknown): value is SessionData {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const { id, accessToken, account } = value as Partial<Record<keyof SessionData, unknown>>;
	return (
		typeof id === "string" &&
		typeof accessToken === "string" &&
		typeof account === "object" &&
		account !== null &&
		typeof (account as { id?: unknown }).id === "string" &&
		typeof (account as { label?: unknown }).label === "string"
	);
}

export class VercelAIAuthenticationProvider implements AuthenticationProvider, Disposable {
	private _sessionChangeEmitter =
		new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
	private _disposable: Disposable;
	private writeQueue: Promise<void> = Promise.resolve();
	private inflightRefresh = new Map<string, Promise<SessionData>>();
	private unreadableSessionsNotified = false;

	constructor(private readonly context: ExtensionContext) {
		this._disposable = authentication.registerAuthenticationProvider(
			EXTENSION_ID,
			"Vercel AI Gateway",
			this,
			// Several sessions can be stored at once, each its own account, so VS Code has to
			// be told that multiple accounts are possible for it to keep them apart.
			{ supportsMultipleAccounts: true },
		);
	}

	get onDidChangeSessions(): Event<AuthenticationProviderAuthenticationSessionsChangeEvent> {
		return this._sessionChangeEmitter.event;
	}

	dispose(): void {
		this._disposable.dispose();
		this._sessionChangeEmitter.dispose();
	}

	async getSessions(
		_scopes?: readonly string[],
		options?: AuthenticationProviderSessionOptions,
	): Promise<AuthenticationSession[]> {
		const snapshot = await this.getSessionsData();
		const refreshed = await this.refreshSessionTokens(snapshot);

		let refreshedSessions = snapshot;
		if (refreshed.length > 0) {
			const result = await this.applyRefreshedSessions(refreshed);
			refreshedSessions = result.sessions;

			// Fire session change event for refreshed tokens
			if (result.changed.length > 0) {
				const changedAuthSessions: AuthenticationSession[] = result.changed.map((session) => ({
					id: session.id,
					accessToken: session.accessToken,
					account: session.account,
					scopes: [...session.scopes],
				}));
				this._sessionChangeEmitter.fire({
					added: [],
					removed: [],
					changed: changedAuthSessions,
				});
			}
		}

		// VS Code passes the account when it wants the sessions for one specific account.
		const requestedAccountId = options?.account?.id;
		const matchingSessions = requestedAccountId
			? refreshedSessions.filter((session) => session.account.id === requestedAccountId)
			: refreshedSessions;

		// Sort sessions so the active session comes first
		const activeSessionId = await this.getActiveSessionId();
		const sortedSessions = [...matchingSessions].sort((a, b) => {
			if (a.id === activeSessionId) {
				return -1;
			}
			if (b.id === activeSessionId) {
				return 1;
			}
			return 0;
		});

		return this.convertToAuthSessions(sortedSessions);
	}

	/** Returns only the sessions whose token changed. */
	private async refreshSessionTokens(sessions: SessionData[]): Promise<SessionData[]> {
		const changedSessions: SessionData[] = [];

		for (const session of sessions) {
			if (session.method === "oidc" && session.oidcData) {
				try {
					const refreshedSession = await this.refreshOidcSessionOnce(session);
					if (refreshedSession.accessToken !== session.accessToken) {
						changedSessions.push(refreshedSession);
					}
				} catch (error) {
					logger.error("Failed to refresh OIDC token in getSessions:", error);
				}
			}
		}

		return changedSessions;
	}

	/**
	 * Merges refreshed tokens into the stored array by id. Sessions removed meanwhile stay
	 * removed, and a token another caller already stored is not reported as changed again.
	 */
	private applyRefreshedSessions(
		refreshed: SessionData[],
	): Promise<{ sessions: SessionData[]; changed: SessionData[] }> {
		return this.withLock(async () => {
			const sessions = await this.getSessionsData();
			const changed: SessionData[] = [];

			for (const update of refreshed) {
				const index = sessions.findIndex((s) => s.id === update.id);
				if (index === -1 || sessions[index].accessToken === update.accessToken) {
					continue;
				}
				sessions[index] = {
					...sessions[index],
					accessToken: update.accessToken,
					oidcData: update.oidcData,
				};
				changed.push(sessions[index]);
			}

			if (changed.length > 0) {
				await this.context.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify(sessions));
			}
			return { sessions, changed };
		});
	}

	private withLock<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.writeQueue.then(fn);
		this.writeQueue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	private refreshOidcSessionOnce(session: SessionData): Promise<SessionData> {
		const inflight = this.inflightRefresh.get(session.id);
		if (inflight) {
			return inflight;
		}

		const refresh = this.refreshOidcSession(session).finally(() => {
			this.inflightRefresh.delete(session.id);
		});
		this.inflightRefresh.set(session.id, refresh);
		return refresh;
	}

	private async refreshOidcSession(session: SessionData): Promise<SessionData> {
		if (!session.oidcData) {
			return session;
		}

		const storedToken = {
			token: session.accessToken,
			expiresAt: session.oidcData.expiresAt,
			projectId: session.oidcData.projectId,
			projectName: session.oidcData.projectName,
			teamId: session.oidcData.teamId,
			teamName: session.oidcData.teamName,
		};

		const refreshedToken = await refreshOidcToken(storedToken);

		return {
			...session,
			accessToken: refreshedToken.token,
			oidcData: {
				...session.oidcData,
				expiresAt: refreshedToken.expiresAt,
				projectName: refreshedToken.projectName,
				teamName: refreshedToken.teamName,
			},
		};
	}

	private convertToAuthSessions(sessions: SessionData[]): AuthenticationSession[] {
		return sessions.map((session) => ({
			id: session.id,
			accessToken: session.accessToken,
			account: session.account,
			scopes: session.scopes,
		}));
	}

	private async getSessionsData(): Promise<SessionData[]> {
		const stored = await this.context.secrets.get(SESSIONS_SECRET_KEY);
		if (!stored) {
			return [];
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(stored);
		} catch (error) {
			const errorName = error instanceof Error ? error.name : typeof error;
			logger.warn(`Stored sessions are not valid JSON (${errorName}, length ${stored.length})`);
			this.notifyUnreadableSessions();
			// Not awaited: callers already inside the write queue would wait on themselves.
			void this.discardUnreadableSessions(stored);
			return [];
		}
		if (!Array.isArray(parsed)) {
			logger.warn(`Stored sessions are not an array (${typeof parsed})`);
			this.notifyUnreadableSessions();
			return [];
		}

		const sessions = parsed.filter(isStoredSession);
		if (sessions.length < parsed.length) {
			logger.warn(`Ignoring ${parsed.length - sessions.length} malformed stored session(s)`);
			this.notifyUnreadableSessions();
		}
		return sessions.map((session) => ({
			...session,
			scopes: Array.isArray(session.scopes) ? session.scopes : [],
			method: session.method || "api-key",
			// Migrate sessions stored before account ids were unique per session.
			account: LEGACY_ACCOUNT_IDS.has(session.account.id)
				? { ...session.account, id: session.id }
				: session.account,
		}));
	}

	/** Deletes the secret only if it still holds the unreadable value, so a newer store survives. */
	private discardUnreadableSessions(unreadable: string): Promise<void> {
		return this.withLock(async () => {
			if ((await this.context.secrets.get(SESSIONS_SECRET_KEY)) === unreadable) {
				await this.context.secrets.delete(SESSIONS_SECRET_KEY);
			}
		}).catch((error) => {
			logger.error("Failed to delete unreadable stored sessions:", error);
		});
	}

	private notifyUnreadableSessions(): void {
		if (this.unreadableSessionsNotified) {
			return;
		}
		this.unreadableSessionsNotified = true;
		const action = "Manage Authentication";
		void Promise.resolve(
			window.showWarningMessage(
				"Some stored Vercel AI Gateway sessions could not be read and must be added again.",
				action,
			),
		).then((choice) => {
			if (choice === action) {
				return this.manageAuthentication();
			}
		});
	}

	async createSession(_scopes: readonly string[]): Promise<AuthenticationSession> {
		const authMethod = await this.promptForAuthMethod();
		if (!authMethod) {
			throw new AuthCancelledError("Authentication method required");
		}

		return authMethod === "oidc" ? this.createOidcSession() : this.createApiKeySession();
	}

	private async createApiKeySession(): Promise<AuthenticationSession> {
		const sessionName = await this.promptForSessionName();
		if (!sessionName) {
			throw new AuthCancelledError("Session name required");
		}

		const apiKey = await this.promptForApiKey();
		if (!apiKey) {
			throw new AuthCancelledError("API key required");
		}

		// The account id must be unique per session, otherwise VS Code treats every session as
		// the same account and cannot switch between them.
		const sessionId = this.generateSessionId();
		const session: SessionData = {
			id: sessionId,
			accessToken: apiKey,
			account: { id: sessionId, label: sessionName },
			scopes: [],
			method: "api-key",
		};

		await this.storeSession(session);
		return session;
	}

	private async createOidcSession(): Promise<AuthenticationSession> {
		if (!checkVercelCliAvailable()) {
			window.showErrorMessage(ERROR_MESSAGES.VERCEL_CLI_NOT_LOGGED_IN);
			throw new Error(ERROR_MESSAGES.VERCEL_CLI_NOT_LOGGED_IN);
		}

		const storedToken = await createInteractiveOidcSession();

		const teamLabel = storedToken.teamName ? ` (${storedToken.teamName})` : "";
		const sessionId = this.generateSessionId();
		const session: SessionData = {
			id: sessionId,
			accessToken: storedToken.token,
			account: {
				id: sessionId,
				label: `${storedToken.projectName}${teamLabel}`,
			},
			scopes: [],
			method: "oidc",
			oidcData: {
				projectId: storedToken.projectId,
				projectName: storedToken.projectName,
				teamId: storedToken.teamId,
				teamName: storedToken.teamName,
				expiresAt: storedToken.expiresAt,
			},
		};

		await this.storeSession(session);
		return session;
	}

	private async storeSession(session: SessionData): Promise<void> {
		await this.withLock(async () => {
			const existingSessions = await this.getSessionsData();
			const sessions = [...existingSessions, session];
			await this.context.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify(sessions));
			await this.setActiveSession(session.id);
		});

		this._sessionChangeEmitter.fire({
			added: [session],
			removed: [],
			changed: [],
		});
		window.showInformationMessage("Authentication successful!");
	}

	async removeSession(sessionId: string): Promise<void> {
		const result = await this.withLock(async () => {
			const sessions = await this.getSessionsData();
			const index = sessions.findIndex((s) => s.id === sessionId);

			if (index === -1) {
				return null;
			}

			const [removed] = sessions.splice(index, 1);
			await this.context.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify(sessions));

			let newActive: SessionData | undefined;
			const activeSessionId = await this.getActiveSessionId();
			if (activeSessionId === sessionId) {
				newActive = sessions[0];
				await this.setActiveSession(newActive?.id ?? null);
			}
			return { removed, newActive };
		});

		if (!result) {
			return;
		}

		const { removed, newActive } = result;
		if (newActive) {
			const methodLabel = this.getMethodLabel(newActive.method);
			window.showInformationMessage(`Activated: ${newActive.account.label} ${methodLabel}`);
		}

		const removedAuthSession: AuthenticationSession = {
			id: removed.id,
			accessToken: removed.accessToken,
			account: removed.account,
			scopes: removed.scopes,
		};
		this._sessionChangeEmitter.fire({
			added: [],
			removed: [removedAuthSession],
			changed: [],
		});
		window.showInformationMessage("Session removed");
	}

	private async promptForSessionName(): Promise<string | undefined> {
		return window.showInputBox({
			prompt: "Enter a name for this session",
			placeHolder: "e.g., Personal, Work, Project Name",
			ignoreFocusOut: true,
			validateInput: this.validateSessionName,
		});
	}

	private async promptForApiKey(): Promise<string | undefined> {
		return window.showInputBox({
			prompt: "Enter your Vercel AI Gateway API key",
			password: true,
			placeHolder: "vck_...",
			ignoreFocusOut: true,
			validateInput: this.validateApiKey,
		});
	}

	private validateSessionName(value: string): string | null {
		return !value?.trim() ? "Session name required" : null;
	}

	private validateApiKey(value: string): string | null {
		if (!value?.trim()) {
			return "API key required";
		}
		if (!value.startsWith("vck_")) {
			return 'API key must start with "vck_"';
		}
		return null;
	}

	private generateSessionId(): string {
		return `${EXTENSION_ID}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
	}

	private getMethodLabel(method: AuthenticationMethod): string {
		return method === "oidc" ? "[OIDC]" : "[API Key]";
	}

	async manageAuthentication(): Promise<void> {
		try {
			const sessions = await this.getSessionsData();
			if (sessions.length === 0) {
				await this.createSession([]);
				return;
			}

			const action = await this.promptForAction(sessions);
			await this.executeAction(action, sessions);
		} catch (error) {
			if (error instanceof AuthCancelledError) {
				logger.debug(`Authentication management cancelled: ${error.message}`);
				return;
			}
			logger.error("Error in manage authentication:", error);
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			window.showErrorMessage(`Authentication management failed: ${errorMessage}`);
		}
	}

	private async promptForAuthMethod(): Promise<AuthenticationMethod | undefined> {
		const options = [
			{
				label: "API Key",
				description: "Manual API key entry",
				value: "api-key" as AuthenticationMethod,
			},
		];

		// Only show OIDC option if Vercel CLI is logged in
		if (checkVercelCliAvailable()) {
			options.push({
				label: "Vercel OIDC",
				description: "Use a Vercel OIDC project token",
				value: "oidc" as AuthenticationMethod,
			});
		}

		const result = await window.showQuickPick(options, {
			placeHolder: "Select authentication method",
		});
		return result?.value;
	}

	private async promptForAction(sessions: SessionData[]): Promise<string | undefined> {
		const activeSession = await this.getActiveSession();
		const methodLabel = activeSession ? this.getMethodLabel(activeSession.method) : "";
		const activeSessionName = activeSession
			? `${activeSession.account.label} ${methodLabel}`
			: "None";

		const options = [{ label: "Add new authentication", value: "add" }];
		if (sessions.length > 1) {
			options.push({ label: "Switch active session", value: "switch" });
		}
		options.push(
			{ label: "Remove session", value: "remove" },
			{ label: "Cancel", value: "cancel" },
		);

		const result = await window.showQuickPick(options, {
			placeHolder: `Active session: ${activeSessionName} - Choose an action`,
		});
		return result?.value;
	}

	private async executeAction(action: string | undefined, sessions: SessionData[]): Promise<void> {
		if (!action || action === "cancel") {
			window.showInformationMessage("Authentication management cancelled.");
			return;
		}

		try {
			switch (action) {
				case "add":
					await this.createSession([]);
					break;
				case "switch":
					await this.switchActiveSession();
					break;
				case "remove":
					await this.handleRemoveSession(sessions);
					break;
				default:
					window.showWarningMessage(`Unknown action: ${action}`);
			}
		} catch (error) {
			if (error instanceof AuthCancelledError) {
				logger.debug(`Action ${action} cancelled: ${error.message}`);
				return;
			}
			logger.error(`Error executing action ${action}:`, error);
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			window.showErrorMessage(`Failed to ${action} session: ${errorMessage}`);
		}
	}

	private async handleRemoveSession(sessions: SessionData[]): Promise<void> {
		if (sessions.length === 1) {
			await this.removeSession(sessions[0].id);
			return;
		}

		const selected = await window.showQuickPick(
			sessions.map((s) => ({
				label: `${s.account.label} ${this.getMethodLabel(s.method)}`,
				value: s.id,
			})),
			{ placeHolder: "Select session to remove" },
		);
		if (selected) {
			await this.removeSession(selected.value);
		}
	}

	/**
	 * The session the user made active, for callers that own this provider. They read it directly
	 * rather than through `authentication.getSession`, which refuses to hand back sessions created
	 * via the provider interface because no consumer-side access grant was ever recorded for them.
	 */
	async getActiveSession(): Promise<SessionData | null> {
		const sessions = await this.getSessionsData();
		if (sessions.length === 0) {
			return null;
		}

		const activeSessionId = await this.getActiveSessionId();
		let activeSession: SessionData | undefined;

		if (activeSessionId) {
			activeSession = sessions.find((s) => s.id === activeSessionId);
		}

		// Fall back to first session if active session not found
		if (!activeSession) {
			activeSession = sessions[0];
		}

		// Refresh OIDC token if needed
		if (activeSession.method === "oidc" && activeSession.oidcData) {
			try {
				const refreshedSession = await this.refreshOidcSessionOnce(activeSession);
				if (refreshedSession.accessToken !== activeSession.accessToken) {
					// Update the stored session with refreshed token
					await this.updateStoredSession(refreshedSession);
				}
				return refreshedSession;
			} catch (error) {
				logger.error("Failed to refresh OIDC token in getActiveSession:", error);
				// Return the original session if refresh fails
				return activeSession;
			}
		}

		return activeSession;
	}

	private async updateStoredSession(updatedSession: SessionData): Promise<void> {
		const { changed } = await this.applyRefreshedSessions([updatedSession]);

		// Fire session change event to notify VS Code of the token update
		for (const session of changed) {
			const authSession: AuthenticationSession = {
				id: session.id,
				accessToken: session.accessToken,
				account: session.account,
				scopes: [...session.scopes],
			};
			this._sessionChangeEmitter.fire({
				added: [],
				removed: [],
				changed: [authSession],
			});
		}
	}

	private async getActiveSessionId(): Promise<string | null> {
		return this.context.globalState.get(ACTIVE_SESSION_KEY, null);
	}

	private async setActiveSession(sessionId: string | null): Promise<void> {
		await this.context.globalState.update(ACTIVE_SESSION_KEY, sessionId);
	}

	private async switchActiveSession(): Promise<void> {
		const sessions = await this.getSessionsData();
		if (sessions.length <= 1) {
			window.showInformationMessage("You need at least 2 sessions to switch between them.");
			return;
		}

		const activeSessionId = await this.getActiveSessionId();

		const options = sessions.map((s) => ({
			label: `${s.account.label} ${this.getMethodLabel(s.method)}`,
			description: s.id === activeSessionId ? "(currently active)" : "",
			value: s.id,
		}));

		const selected = await window.showQuickPick(options, {
			placeHolder: "Select session to activate",
		});

		if (!selected) {
			return;
		}

		if (selected.value === activeSessionId) {
			window.showInformationMessage("Session is already active.");
			return;
		}

		await this.setActiveSession(selected.value);
		const selectedSession = sessions.find((s) => s.id === selected.value);
		const methodLabel = selectedSession ? this.getMethodLabel(selectedSession.method) : "";

		// Fire session change event to notify VS Code that sessions have changed
		if (selectedSession) {
			const authSession: AuthenticationSession = {
				id: selectedSession.id,
				accessToken: selectedSession.accessToken,
				account: selectedSession.account,
				scopes: selectedSession.scopes,
			};
			this._sessionChangeEmitter.fire({
				added: [],
				removed: [],
				changed: [authSession],
			});
		}
		window.showInformationMessage(`Switched to: ${selectedSession?.account.label} ${methodLabel}`);
	}
}
