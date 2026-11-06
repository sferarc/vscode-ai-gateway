import {
	type AuthenticationProvider,
	type AuthenticationProviderAuthenticationSessionsChangeEvent,
	type AuthenticationProviderSessionOptions,
	type AuthenticationSession,
	authentication,
	commands,
	type Disposable,
	type Event,
	EventEmitter,
	type ExtensionContext,
	l10n,
	ProgressLocation,
	window,
} from "vscode";
import { getConfig } from "./config";
import { EXTENSION_ID, MODELS_ENDPOINT, SIGNED_IN_CONTEXT_KEY } from "./constants";
import { AuthCancelledError } from "./errors";
import { extractErrorMessage, logger } from "./logger";
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

export type AuthenticationMethod = "api-key" | "oidc" | "environment";

/** The variable the AI SDK and ai-gateway-proxy read the gateway key from. */
const ENVIRONMENT_API_KEY_VARIABLE = "AI_GATEWAY_API_KEY";
const ENVIRONMENT_SESSION_ID = `${VERCEL_AI_AUTH_PROVIDER_ID}.environment`;

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
	private environmentKeyCheck?: { apiKey: string; accepted: Promise<boolean> };
	private signedInContextUpdates = 0;

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

	/** Sets the signed in context key now and again after every session change. */
	watchSignedInContext(): Disposable {
		void this.updateSignedInContext();
		return this.onDidChangeSessions(() => void this.updateSignedInContext());
	}

	private async updateSignedInContext(): Promise<void> {
		const update = ++this.signedInContextUpdates;
		try {
			const signedIn =
				(await this.getSessionsData()).length > 0 || (await this.getEnvironmentSession()) !== null;
			// A later session change may have finished first, and its value is the current one.
			if (update === this.signedInContextUpdates) {
				await commands.executeCommand("setContext", SIGNED_IN_CONTEXT_KEY, signedIn);
			}
		} catch (error) {
			logger.warn(`Failed to update the signed in context key: ${extractErrorMessage(error)}`);
		}
	}

	async getSessions(
		_scopes?: readonly string[],
		options?: AuthenticationProviderSessionOptions,
	): Promise<AuthenticationSession[]> {
		const snapshot = await this.getSessionsData();
		if (snapshot.length === 0) {
			const environment = await this.getEnvironmentSession();
			const requestedAccountId = options?.account?.id;
			return environment && (!requestedAccountId || requestedAccountId === environment.account.id)
				? this.convertToAuthSessions([environment])
				: [];
		}
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
				const current = sessions[index];
				if (!current || current.accessToken === update.accessToken) {
					continue;
				}
				const merged = { ...current, accessToken: update.accessToken, oidcData: update.oidcData };
				sessions[index] = merged;
				changed.push(merged);
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
		const action = l10n.t("Manage Authentication");
		void Promise.resolve(
			window.showWarningMessage(
				l10n.t("Some stored Vercel AI Gateway sessions could not be read and must be added again."),
				action,
			),
		).then((choice) => (choice === action ? this.manageAuthentication() : undefined));
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

		const apiKey = (await this.promptForApiKey())?.trim();
		if (!apiKey) {
			throw new AuthCancelledError("API key required");
		}
		await verifyApiKey(apiKey);

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
			const message = l10n.t("Vercel CLI not logged in. Please run `vercel login` first.");
			window.showErrorMessage(message);
			throw new Error(message);
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
		window.showInformationMessage(l10n.t("Authentication successful!"));
	}

	async removeSession(sessionId: string): Promise<void> {
		if (sessionId === ENVIRONMENT_SESSION_ID) {
			window.showInformationMessage(
				l10n.t(
					"This session comes from the {0} environment variable. Unset it and reload the window to sign out.",
					ENVIRONMENT_API_KEY_VARIABLE,
				),
			);
			return;
		}
		const result = await this.withLock(async () => {
			const sessions = await this.getSessionsData();
			const index = sessions.findIndex((s) => s.id === sessionId);
			const removed = sessions[index];

			if (!removed) {
				return null;
			}

			sessions.splice(index, 1);
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
			window.showInformationMessage(
				l10n.t("Activated: {0} {1}", newActive.account.label, methodLabel),
			);
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
		window.showInformationMessage(l10n.t("Session removed"));
	}

	private async promptForSessionName(): Promise<string | undefined> {
		return window.showInputBox({
			prompt: l10n.t("Enter a name for this session"),
			placeHolder: l10n.t("e.g., Personal, Work, Project Name"),
			ignoreFocusOut: true,
			validateInput: this.validateSessionName,
		});
	}

	private async promptForApiKey(): Promise<string | undefined> {
		return window.showInputBox({
			prompt: l10n.t("Enter your Vercel AI Gateway API key"),
			password: true,
			placeHolder: "vck_...",
			ignoreFocusOut: true,
			validateInput: this.validateApiKey,
		});
	}

	private validateSessionName(value: string): string | null {
		return !value?.trim() ? l10n.t("Session name required") : null;
	}

	private validateApiKey(value: string): string | null {
		const key = value?.trim();
		if (!key) {
			return l10n.t("API key required");
		}
		if (!key.startsWith("vck_")) {
			return l10n.t('API key must start with "vck_"');
		}
		return null;
	}

	private generateSessionId(): string {
		return `${EXTENSION_ID}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
	}

	private getMethodLabel(method: AuthenticationMethod): string {
		if (method === "environment") {
			return l10n.t("[Environment]");
		}
		return method === "oidc" ? l10n.t("[OIDC]") : l10n.t("[API Key]");
	}

	/**
	 * A session for the key in the extension host's environment, used only while none is stored.
	 * It lives in memory only; a key the gateway rejects with 401 is ignored until the window reloads.
	 */
	private async getEnvironmentSession(): Promise<SessionData | null> {
		const apiKey = process.env[ENVIRONMENT_API_KEY_VARIABLE]?.trim();
		if (!apiKey) {
			return null;
		}
		if (this.environmentKeyCheck?.apiKey !== apiKey) {
			this.environmentKeyCheck = { apiKey, accepted: this.checkEnvironmentKey(apiKey) };
		}
		if (!(await this.environmentKeyCheck.accepted)) {
			return null;
		}
		return {
			id: ENVIRONMENT_SESSION_ID,
			accessToken: apiKey,
			account: { id: ENVIRONMENT_SESSION_ID, label: ENVIRONMENT_API_KEY_VARIABLE },
			scopes: [],
			method: "environment",
		};
	}

	private async checkEnvironmentKey(apiKey: string): Promise<boolean> {
		const status = await fetchApiKeyStatus(
			apiKey,
			`Using ${ENVIRONMENT_API_KEY_VARIABLE} unchecked`,
		);
		if (status !== 401) {
			return true;
		}
		logger.warn(`The gateway rejected ${ENVIRONMENT_API_KEY_VARIABLE} (HTTP 401); ignoring it`);
		window.showWarningMessage(
			l10n.t(
				"The gateway rejected the API key in {0} (HTTP 401). Set a valid key and reload the window, or run Manage Authentication to add one.",
				ENVIRONMENT_API_KEY_VARIABLE,
			),
		);
		return false;
	}

	async manageAuthentication(): Promise<void> {
		try {
			const sessions = await this.getSessionsData();
			if (sessions.length === 0 && !(await this.getEnvironmentSession())) {
				await this.createSession([]);
				return;
			}

			const action = await this.promptForAction(sessions);
			await this.executeAction(action, sessions);
		} catch (error) {
			if (error instanceof AuthCancelledError) {
				logger.debug(`Authentication management cancelled: ${error.reason}`);
				return;
			}
			logger.error("Error in manage authentication:", error);
			const errorMessage =
				error instanceof Error ? error.message : l10n.t("Unknown error occurred");
			window.showErrorMessage(l10n.t("Authentication management failed: {0}", errorMessage));
		}
	}

	private async promptForAuthMethod(): Promise<AuthenticationMethod | undefined> {
		const options = [
			{
				label: l10n.t("API Key"),
				description: l10n.t("Manual API key entry"),
				value: "api-key" as AuthenticationMethod,
			},
		];

		// Only show OIDC option if Vercel CLI is logged in
		if (checkVercelCliAvailable()) {
			options.push({
				label: l10n.t("Vercel OIDC"),
				description: l10n.t("Use a Vercel OIDC project token"),
				value: "oidc" as AuthenticationMethod,
			});
		}

		const result = await window.showQuickPick(options, {
			placeHolder: l10n.t("Select authentication method"),
		});
		return result?.value;
	}

	private async promptForAction(sessions: SessionData[]): Promise<string | undefined> {
		const activeSession = await this.getActiveSession();
		const methodLabel = activeSession ? this.getMethodLabel(activeSession.method) : "";
		const activeSessionName = activeSession
			? `${activeSession.account.label} ${methodLabel}`
			: l10n.t("None");

		const options = [{ label: l10n.t("Add new authentication"), value: "add" }];
		if (sessions.length > 1) {
			options.push({ label: l10n.t("Switch active session"), value: "switch" });
		}
		// The environment session cannot be removed from here, only stored sessions.
		if (sessions.length > 0) {
			options.push({ label: l10n.t("Remove session"), value: "remove" });
		}
		options.push({ label: l10n.t("Cancel"), value: "cancel" });

		const result = await window.showQuickPick(options, {
			placeHolder: l10n.t("Active session: {0} - Choose an action", activeSessionName),
		});
		return result?.value;
	}

	private async executeAction(action: string | undefined, sessions: SessionData[]): Promise<void> {
		if (!action || action === "cancel") {
			window.showInformationMessage(l10n.t("Authentication management cancelled."));
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
					window.showWarningMessage(l10n.t("Unknown action: {0}", action));
			}
		} catch (error) {
			if (error instanceof AuthCancelledError) {
				logger.debug(`Action ${action} cancelled: ${error.reason}`);
				return;
			}
			logger.error(`Error executing action ${action}:`, error);
			const errorMessage =
				error instanceof Error ? error.message : l10n.t("Unknown error occurred");
			window.showErrorMessage(actionFailedMessage(action, errorMessage));
		}
	}

	private async handleRemoveSession(sessions: SessionData[]): Promise<void> {
		const [only] = sessions;
		if (sessions.length === 1 && only) {
			await this.removeSession(only.id);
			return;
		}

		const selected = await window.showQuickPick(
			sessions.map((s) => ({
				label: `${s.account.label} ${this.getMethodLabel(s.method)}`,
				value: s.id,
			})),
			{ placeHolder: l10n.t("Select session to remove") },
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
			return this.getEnvironmentSession();
		}

		const activeSessionId = await this.getActiveSessionId();
		// Fall back to first session if active session not found
		const activeSession =
			(activeSessionId ? sessions.find((s) => s.id === activeSessionId) : undefined) ?? sessions[0];
		if (!activeSession) {
			return null;
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
			window.showInformationMessage(l10n.t("You need at least 2 sessions to switch between them."));
			return;
		}

		const activeSessionId = await this.getActiveSessionId();

		const options = sessions.map((s) => ({
			label: `${s.account.label} ${this.getMethodLabel(s.method)}`,
			description: s.id === activeSessionId ? l10n.t("(currently active)") : "",
			value: s.id,
		}));

		const selected = await window.showQuickPick(options, {
			placeHolder: l10n.t("Select session to activate"),
		});

		if (!selected) {
			return;
		}

		if (selected.value === activeSessionId) {
			window.showInformationMessage(l10n.t("Session is already active."));
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
		window.showInformationMessage(
			l10n.t("Switched to: {0} {1}", String(selectedSession?.account.label), methodLabel),
		);
	}
}

// One message per action, since a translator cannot translate the action's internal value.
function actionFailedMessage(action: string, errorMessage: string): string {
	switch (action) {
		case "add":
			return l10n.t("Failed to add session: {0}", errorMessage);
		case "switch":
			return l10n.t("Failed to switch session: {0}", errorMessage);
		case "remove":
			return l10n.t("Failed to remove session: {0}", errorMessage);
		default:
			return l10n.t("Authentication management failed: {0}", errorMessage);
	}
}

// Only a 401 refuses the key, so an unreachable or failing gateway never blocks sign-in.
async function verifyApiKey(apiKey: string): Promise<void> {
	const status = await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: l10n.t("Checking the API key with Vercel AI Gateway"),
		},
		() => fetchApiKeyStatus(apiKey, "Saving the API key unchecked"),
	);
	if (status === 401) {
		throw new Error(
			l10n.t(
				"The gateway rejected this API key (HTTP 401). Copy the key again from the AI Gateway dashboard, or create a new one, and add it again.",
			),
		);
	}
}

/** The gateway's status for the key, or undefined when it could not be reached. */
async function fetchApiKeyStatus(
	apiKey: string,
	uncheckedLog: string,
): Promise<number | undefined> {
	const { endpoint, timeout } = getConfig();
	let status: number;
	try {
		const response = await fetch(`${endpoint}${MODELS_ENDPOINT}`, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(timeout),
		});
		status = response.status;
		response.body?.cancel().catch(() => undefined);
	} catch (error) {
		logger.warn(`${uncheckedLog}: ${extractErrorMessage(error)}`);
		return undefined;
	}
	if (status !== 401 && (status < 200 || status >= 300)) {
		logger.warn(`${uncheckedLog}: the gateway answered HTTP ${status}`);
	}
	return status;
}
