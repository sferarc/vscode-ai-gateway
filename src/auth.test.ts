import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	mockEventEmitterFire: vi.fn(),
	MockEventEmitter: class {
		event = vi.fn();
		fire = hoisted.mockEventEmitterFire;
		dispose = vi.fn();
	},
	mockShowQuickPick: vi.fn(),
	mockShowInputBox: vi.fn(),
	mockExecuteCommand: vi.fn(),
}));

vi.mock("vscode", () => ({
	EventEmitter: hoisted.MockEventEmitter,
	ProgressLocation: { Notification: 15 },
	authentication: { registerAuthenticationProvider: vi.fn(() => ({ dispose: vi.fn() })) },
	commands: { executeCommand: hoisted.mockExecuteCommand },
	window: {
		showInputBox: hoisted.mockShowInputBox,
		showQuickPick: hoisted.mockShowQuickPick,
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		withProgress: vi.fn((_options: unknown, task: () => unknown) => task()),
	},
}));

vi.mock("./config", () => ({
	getConfig: () => ({ endpoint: "https://gateway.test", timeout: 30000 }),
}));

vi.mock("./logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
	extractErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock("./vercel-auth", () => ({
	checkVercelCliAvailable: vi.fn(() => false),
	createInteractiveOidcSession: vi.fn(),
	refreshOidcToken: vi.fn(),
}));

import { type ExtensionContext, window } from "vscode";
import { VercelAIAuthenticationProvider } from "./auth";
import { AuthCancelledError } from "./errors";
import { logger } from "./logger";
import {
	checkVercelCliAvailable,
	createInteractiveOidcSession,
	refreshOidcToken,
} from "./vercel-auth";

const SESSIONS_KEY = "vercelAiGateway.sessions";
const ACTIVE_KEY = "vercelAiGateway.activeSession";
const NOW = new Date("2026-01-01T00:00:00Z").getTime();

function createMockContext(): ExtensionContext {
	const secrets = new Map<string, string>();
	const globalState = new Map<string, unknown>();
	return {
		secrets: {
			get: vi.fn((key: string) => Promise.resolve(secrets.get(key))),
			store: vi.fn((key: string, value: string) => {
				secrets.set(key, value);
				return Promise.resolve();
			}),
			delete: vi.fn((key: string) => {
				secrets.delete(key);
				return Promise.resolve();
			}),
			onDidChange: vi.fn(),
		},
		globalState: {
			get: vi.fn((key: string, defaultValue?: unknown) => globalState.get(key) ?? defaultValue),
			update: vi.fn((key: string, value: unknown) => {
				globalState.set(key, value);
				return Promise.resolve();
			}),
			keys: vi.fn(() => Array.from(globalState.keys())),
			setKeysForSync: vi.fn(),
		},
		subscriptions: [],
	} as unknown as ExtensionContext;
}

function createSession(id: string, method: "api-key" | "oidc" = "api-key", expiresAt?: number) {
	const base = {
		id,
		accessToken: "token",
		account: { id: "user", label: "Test" },
		scopes: [],
		method,
	};
	return method === "oidc"
		? {
				...base,
				oidcData: {
					projectId: "p1",
					projectName: "P",
					teamId: "t1",
					teamName: "T",
					expiresAt: expiresAt ?? NOW + 3600000,
				},
			}
		: base;
}

describe("VercelAIAuthenticationProvider", () => {
	let ctx: ExtensionContext;
	let provider: VercelAIAuthenticationProvider;

	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
		vi.clearAllMocks();
		fetchMock = vi.fn(async () => new Response('{"data":[]}', { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		vi.stubEnv("AI_GATEWAY_API_KEY", "");
		ctx = createMockContext();
		provider = new VercelAIAuthenticationProvider(ctx);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("returns empty sessions when none exist", async () => {
		expect(await provider.getSessions()).toEqual([]);
	});

	it("returns stored sessions", async () => {
		await ctx.secrets.store("vercelAiGateway.sessions", JSON.stringify([createSession("s1")]));
		const sessions = await provider.getSessions();
		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.id).toBe("s1");
	});

	it("refreshes near-expiry OIDC tokens and fires change event", async () => {
		const session = createSession("s1", "oidc", NOW + 5 * 60 * 1000);
		await ctx.secrets.store("vercelAiGateway.sessions", JSON.stringify([session]));

		vi.mocked(refreshOidcToken).mockResolvedValueOnce({
			token: "new_token",
			expiresAt: NOW + 3600000,
			projectId: "p1",
			projectName: "P",
			teamId: "t1",
			teamName: "T",
		});

		const sessions = await provider.getSessions();
		expect(refreshOidcToken).toHaveBeenCalled();
		expect(sessions[0]?.accessToken).toBe("new_token");
		expect(hoisted.mockEventEmitterFire).toHaveBeenCalled();
	});

	it("returns original session when refresh fails", async () => {
		const session = createSession("s1", "oidc", NOW + 5 * 60 * 1000);
		await ctx.secrets.store("vercelAiGateway.sessions", JSON.stringify([session]));
		vi.mocked(refreshOidcToken).mockRejectedValueOnce(new Error("fail"));

		const sessions = await provider.getSessions();
		expect(sessions[0]?.accessToken).toBe("token");
	});

	it("removes session and fires event", async () => {
		await ctx.secrets.store(
			"vercelAiGateway.sessions",
			JSON.stringify([createSession("s1"), createSession("s2")]),
		);
		await provider.removeSession("s1");

		const stored = JSON.parse((await ctx.secrets.get("vercelAiGateway.sessions")) || "[]");
		expect(stored).toHaveLength(1);
		expect(hoisted.mockEventEmitterFire).toHaveBeenCalledWith(
			expect.objectContaining({ removed: expect.any(Array) }),
		);
	});

	it("creates API key session", async () => {
		hoisted.mockShowQuickPick.mockResolvedValueOnce({
			label: "API Key",
			value: "api-key",
		} as never);
		hoisted.mockShowInputBox.mockResolvedValueOnce("My Session").mockResolvedValueOnce("vck_key");

		const session = await provider.createSession([]);
		expect(session.accessToken).toBe("vck_key");
	});

	it("makes a newly added session the active one", async () => {
		await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1")]));
		await ctx.globalState.update(ACTIVE_KEY, "s1");
		hoisted.mockShowQuickPick.mockResolvedValueOnce({
			label: "API Key",
			value: "api-key",
		} as never);
		hoisted.mockShowInputBox.mockResolvedValueOnce("Second").mockResolvedValueOnce("vck_second");

		const session = await provider.createSession([]);

		expect(ctx.globalState.get(ACTIVE_KEY)).toBe(session.id);
		expect(session.id).not.toBe("s1");
		expect((await provider.getSessions()).map((s) => s.id)).toEqual([session.id, "s1"]);
	});

	describe("OIDC session label", () => {
		const token = {
			token: "oidc_token",
			expiresAt: NOW + 3600000,
			projectId: "p1",
			projectName: "My Project",
			teamId: "t1",
			teamName: "My Team",
		};

		async function addOidc(overrides: Partial<typeof token>) {
			vi.mocked(checkVercelCliAvailable).mockReturnValue(true);
			vi.mocked(createInteractiveOidcSession).mockResolvedValueOnce({ ...token, ...overrides });
			hoisted.mockShowQuickPick.mockResolvedValueOnce({
				label: "Vercel OIDC",
				value: "oidc",
			} as never);
			return provider.createSession([]);
		}

		it("labels the account with the project and team", async () => {
			const session = await addOidc({});
			expect(session.account.label).toBe("My Project (My Team)");
		});

		it("labels the account with the project alone when there is no team name", async () => {
			const session = await addOidc({ teamName: undefined });
			expect(session.account.label).toBe("My Project");
		});

		it("makes the new OIDC session the active one", async () => {
			const session = await addOidc({});
			expect(ctx.globalState.get(ACTIVE_KEY)).toBe(session.id);
		});
	});

	it("handles corrupted session data gracefully", async () => {
		await ctx.secrets.store("vercelAiGateway.sessions", "invalid{");
		const sessions = await provider.getSessions();
		expect(sessions).toEqual([]);
	});

	describe("active session tracking", () => {
		it("promotes another session when the active one is removed", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([createSession("s1"), createSession("s2")]),
			);
			await ctx.globalState.update(ACTIVE_KEY, "s1");

			await provider.removeSession("s1");

			expect(ctx.globalState.get(ACTIVE_KEY)).toBe("s2");
		});

		it("clears the active session when the last one is removed", async () => {
			await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1")]));
			await ctx.globalState.update(ACTIVE_KEY, "s1");

			await provider.removeSession("s1");

			expect(ctx.globalState.get(ACTIVE_KEY) ?? null).toBeNull();
		});

		it("ignores removal of an unknown session id", async () => {
			await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1")]));
			hoisted.mockEventEmitterFire.mockClear();

			await provider.removeSession("does-not-exist");

			expect(hoisted.mockEventEmitterFire).not.toHaveBeenCalled();
			expect(JSON.parse((await ctx.secrets.get(SESSIONS_KEY)) ?? "[]")).toHaveLength(1);
		});

		it("returns the active session first", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([createSession("s1"), createSession("s2"), createSession("s3")]),
			);
			await ctx.globalState.update(ACTIVE_KEY, "s3");

			const sessions = await provider.getSessions();

			expect(sessions[0]?.id).toBe("s3");
		});

		it("persists a refreshed OIDC token so later reads see it", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([createSession("s1", "oidc", NOW + 60 * 1000)]),
			);
			vi.mocked(refreshOidcToken).mockResolvedValueOnce({
				token: "fresh",
				expiresAt: NOW + 3600000,
				projectId: "p1",
				projectName: "P",
				teamId: "t1",
				teamName: "T",
			});

			await provider.getSessions();

			const stored = JSON.parse((await ctx.secrets.get(SESSIONS_KEY)) ?? "[]");
			expect(stored[0]?.accessToken).toBe("fresh");
		});

		it("keeps other sessions when one OIDC refresh fails", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([createSession("s1", "oidc", NOW + 60 * 1000), createSession("s2")]),
			);
			vi.mocked(refreshOidcToken).mockRejectedValueOnce(new Error("boom"));

			const sessions = await provider.getSessions();

			expect(sessions.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
		});
	});

	describe("concurrent session writes", () => {
		function deferredRefresh() {
			let resolve: () => void = () => undefined;
			const gate = new Promise<void>((r) => {
				resolve = r;
			});
			vi.mocked(refreshOidcToken).mockImplementation(async () => {
				await gate;
				return {
					token: "fresh",
					expiresAt: NOW + 3600000,
					projectId: "p1",
					projectName: "P",
					teamId: "t1",
					teamName: "T",
				};
			});
			return resolve;
		}

		const refreshStarted = () => vi.waitFor(() => expect(refreshOidcToken).toHaveBeenCalled());
		const storedSessions = async () =>
			JSON.parse((await ctx.secrets.get(SESSIONS_KEY)) ?? "[]") as Array<{
				id: string;
				accessToken: string;
			}>;

		beforeEach(async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([createSession("s1", "oidc", NOW + 60 * 1000)]),
			);
			hoisted.mockEventEmitterFire.mockClear();
		});

		afterEach(() => {
			vi.mocked(refreshOidcToken).mockReset();
		});

		it("shares one OIDC refresh between getSessions and getActiveSession", async () => {
			const release = deferredRefresh();

			const sessions = provider.getSessions();
			const active = provider.getActiveSession();
			await refreshStarted();
			release();

			expect((await sessions)[0]?.accessToken).toBe("fresh");
			expect((await active)?.accessToken).toBe("fresh");
			expect(refreshOidcToken).toHaveBeenCalledTimes(1);
			expect(await storedSessions()).toEqual([
				expect.objectContaining({ id: "s1", accessToken: "fresh" }),
			]);
			expect(hoisted.mockEventEmitterFire).toHaveBeenCalledTimes(1);
		});

		it("starts a new OIDC refresh after a shared one times out", async () => {
			let fail: (error: Error) => void = () => undefined;
			vi.mocked(refreshOidcToken).mockImplementationOnce(
				() =>
					new Promise((_, reject) => {
						fail = reject;
					}),
			);

			const sessions = provider.getSessions();
			const active = provider.getActiveSession();
			await refreshStarted();
			fail(new Error("Timed out contacting Vercel after 15000 ms"));

			expect((await sessions)[0]?.accessToken).not.toBe("fresh");
			expect((await active)?.accessToken).not.toBe("fresh");
			expect(refreshOidcToken).toHaveBeenCalledTimes(1);

			const release = deferredRefresh();
			release();
			expect((await provider.getSessions())[0]?.accessToken).toBe("fresh");
			expect(refreshOidcToken).toHaveBeenCalledTimes(2);
		});

		it("keeps a session created during a slow refresh", async () => {
			const release = deferredRefresh();
			const sessions = provider.getSessions();
			await refreshStarted();

			hoisted.mockShowQuickPick.mockResolvedValueOnce({
				label: "API Key",
				value: "api-key",
			} as never);
			hoisted.mockShowInputBox.mockResolvedValueOnce("Work").mockResolvedValueOnce("vck_work");
			const created = await provider.createSession([]);

			release();
			await sessions;

			const stored = await storedSessions();
			expect(stored.map((s) => s.id)).toEqual(["s1", created.id]);
			expect(stored[0]?.accessToken).toBe("fresh");
		});

		it("does not bring back a session removed during a slow refresh", async () => {
			const release = deferredRefresh();
			const sessions = provider.getSessions();
			await refreshStarted();

			await provider.removeSession("s1");

			release();
			expect(await sessions).toEqual([]);
			expect(await storedSessions()).toEqual([]);
		});
	});

	describe("manageAuthentication", () => {
		it("creates a session directly when none exist", async () => {
			hoisted.mockShowQuickPick.mockResolvedValueOnce({
				label: "API Key",
				value: "api-key",
			} as never);
			hoisted.mockShowInputBox.mockResolvedValueOnce("First").mockResolvedValueOnce("vck_first");

			await provider.manageAuthentication();

			expect(JSON.parse((await ctx.secrets.get(SESSIONS_KEY)) ?? "[]")).toHaveLength(1);
		});

		it("switches the active session", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([createSession("s1"), createSession("s2")]),
			);
			await ctx.globalState.update(ACTIVE_KEY, "s1");

			hoisted.mockShowQuickPick
				.mockResolvedValueOnce({ label: "Switch active session", value: "switch" } as never)
				.mockResolvedValueOnce({ label: "s2", value: "s2" } as never);

			await provider.manageAuthentication();

			expect(ctx.globalState.get(ACTIVE_KEY)).toBe("s2");
		});

		it("removes the chosen session", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([createSession("s1"), createSession("s2")]),
			);

			hoisted.mockShowQuickPick
				.mockResolvedValueOnce({ label: "Remove session", value: "remove" } as never)
				.mockResolvedValueOnce({ label: "s1", value: "s1" } as never);

			await provider.manageAuthentication();

			const stored = JSON.parse((await ctx.secrets.get(SESSIONS_KEY)) ?? "[]");
			expect(stored.map((s: { id: string }) => s.id)).toEqual(["s2"]);
		});

		it("changes nothing when the action menu is cancelled", async () => {
			await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1")]));
			hoisted.mockShowQuickPick.mockResolvedValueOnce(undefined as never);

			await provider.manageAuthentication();

			expect(JSON.parse((await ctx.secrets.get(SESSIONS_KEY)) ?? "[]")).toHaveLength(1);
		});

		it("does not offer switching with a single session", async () => {
			await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1")]));
			hoisted.mockShowQuickPick.mockResolvedValueOnce(undefined as never);

			await provider.manageAuthentication();

			const options = hoisted.mockShowQuickPick.mock.calls[0]?.[0] as Array<{ value: string }>;
			expect(options.map((o) => o.value)).not.toContain("switch");
		});
	});

	describe("cancelling a prompt", () => {
		const pickApiKey = { label: "API Key", value: "api-key" } as never;
		const pickOidc = { label: "Vercel OIDC", value: "oidc" } as never;
		const pickAdd = { label: "Add new authentication", value: "add" } as never;

		function expectSilent() {
			expect(window.showErrorMessage).not.toHaveBeenCalled();
			expect(logger.error).not.toHaveBeenCalled();
		}

		it("stays silent when the authentication method picker is dismissed", async () => {
			hoisted.mockShowQuickPick.mockResolvedValueOnce(undefined as never);

			await provider.manageAuthentication();

			expectSilent();
		});

		it("stays silent when the session name prompt is dismissed", async () => {
			await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1")]));
			hoisted.mockShowQuickPick.mockResolvedValueOnce(pickAdd).mockResolvedValueOnce(pickApiKey);
			hoisted.mockShowInputBox.mockResolvedValueOnce(undefined);

			await provider.manageAuthentication();

			expectSilent();
		});

		it("stays silent when the API key prompt is dismissed", async () => {
			await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1")]));
			hoisted.mockShowQuickPick.mockResolvedValueOnce(pickAdd).mockResolvedValueOnce(pickApiKey);
			hoisted.mockShowInputBox.mockResolvedValueOnce("Name").mockResolvedValueOnce(undefined);

			await provider.manageAuthentication();

			expectSilent();
			expect(JSON.parse((await ctx.secrets.get(SESSIONS_KEY)) ?? "[]")).toHaveLength(1);
		});

		it.each(["Team selection cancelled", "Project selection is required"])(
			"stays silent when the OIDC picker is dismissed (%s)",
			async (message) => {
				vi.mocked(checkVercelCliAvailable).mockReturnValue(true);
				vi.mocked(createInteractiveOidcSession).mockRejectedValueOnce(
					new AuthCancelledError(message),
				);
				hoisted.mockShowQuickPick.mockResolvedValueOnce(pickOidc);

				await provider.manageAuthentication();

				expectSilent();
			},
		);

		it.each([
			["method", [undefined], []],
			["session name", [pickApiKey], [undefined]],
			["API key", [pickApiKey], ["Name", undefined]],
		])(
			"rejects createSession with the cancellation VS Code ignores when the %s prompt is dismissed",
			async (_prompt, picks, inputs) => {
				for (const pick of picks) hoisted.mockShowQuickPick.mockResolvedValueOnce(pick as never);
				for (const input of inputs) hoisted.mockShowInputBox.mockResolvedValueOnce(input);

				const error = await provider.createSession([]).catch((e: unknown) => e);

				expect(error).toBeInstanceOf(AuthCancelledError);
				expect(error).toMatchObject({ name: "Canceled", message: "Canceled" });
				expectSilent();
			},
		);

		it("still reports a failure to load teams", async () => {
			vi.mocked(checkVercelCliAvailable).mockReturnValue(true);
			vi.mocked(createInteractiveOidcSession).mockRejectedValueOnce(
				new Error("Failed to load teams: Failed to fetch teams: 500"),
			);
			await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1")]));
			hoisted.mockShowQuickPick.mockResolvedValueOnce(pickAdd).mockResolvedValueOnce(pickOidc);

			await provider.manageAuthentication();

			expect(window.showErrorMessage).toHaveBeenCalledTimes(1);
			expect(window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to add session: Failed to load teams: Failed to fetch teams: 500",
			);
			expect(logger.error).toHaveBeenCalledTimes(1);
		});
	});

	describe("authentication method options", () => {
		it("offers only API key when the Vercel CLI is not logged in", async () => {
			vi.mocked(checkVercelCliAvailable).mockReturnValue(false);
			hoisted.mockShowQuickPick.mockResolvedValueOnce(undefined as never);

			await provider.createSession([]).catch(() => undefined);

			const options = hoisted.mockShowQuickPick.mock.calls[0]?.[0] as Array<{ value: string }>;
			expect(options.map((o) => o.value)).toEqual(["api-key"]);
		});

		it("also offers OIDC when the Vercel CLI is logged in", async () => {
			vi.mocked(checkVercelCliAvailable).mockReturnValue(true);
			hoisted.mockShowQuickPick.mockResolvedValueOnce(undefined as never);

			await provider.createSession([]).catch(() => undefined);

			const options = hoisted.mockShowQuickPick.mock.calls[0]?.[0] as Array<{ value: string }>;
			expect(options.map((o) => o.value)).toEqual(["api-key", "oidc"]);
		});

		it("rejects an API key that is not a vck_ key", async () => {
			hoisted.mockShowQuickPick.mockResolvedValueOnce({
				label: "API Key",
				value: "api-key",
			} as never);
			hoisted.mockShowInputBox.mockResolvedValueOnce("Name").mockResolvedValueOnce("vck_ok");

			await provider.createSession([]);

			const apiKeyPrompt = hoisted.mockShowInputBox.mock.calls[1]?.[0] as {
				validateInput: (value: string) => string | null;
			};
			expect(apiKeyPrompt.validateInput("wrong")).toMatch(/vck_/);
			expect(apiKeyPrompt.validateInput("vck_good")).toBeNull();
		});
	});

	describe("API key check", () => {
		async function addApiKey(key: string) {
			hoisted.mockShowQuickPick.mockResolvedValueOnce({
				label: "API Key",
				value: "api-key",
			} as never);
			hoisted.mockShowInputBox.mockResolvedValueOnce("Work").mockResolvedValueOnce(key);
			return provider.createSession([]);
		}

		it("checks the trimmed key against the gateway and stores it trimmed", async () => {
			const session = await addApiKey("  vck_pasted \n");

			expect(session.accessToken).toBe("vck_pasted");
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("https://gateway.test/v1/models");
			expect(init.headers).toEqual({ Authorization: "Bearer vck_pasted" });
			expect((await provider.getSessions())[0]?.accessToken).toBe("vck_pasted");
		});

		it("accepts a key pasted with surrounding whitespace in the input box", async () => {
			await addApiKey("vck_ok");

			const apiKeyPrompt = hoisted.mockShowInputBox.mock.calls[1]?.[0] as {
				validateInput: (value: string) => string | null;
			};
			expect(apiKeyPrompt.validateInput(" vck_good ")).toBeNull();
			expect(apiKeyPrompt.validateInput("   ")).toBe("API key required");
		});

		it("does not store a key the gateway rejects with 401", async () => {
			fetchMock.mockResolvedValueOnce(new Response('{"error":{}}', { status: 401 }));

			await expect(addApiKey("vck_wrong")).rejects.toThrow(/rejected this API key \(HTTP 401\)/);

			expect(await provider.getSessions()).toEqual([]);
			expect(ctx.globalState.get(ACTIVE_KEY)).toBeUndefined();
		});

		it("names the rejected key in the manage command's error", async () => {
			fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
			hoisted.mockShowQuickPick.mockResolvedValueOnce({
				label: "API Key",
				value: "api-key",
			} as never);
			hoisted.mockShowInputBox.mockResolvedValueOnce("Work").mockResolvedValueOnce("vck_wrong");

			await provider.manageAuthentication();

			expect(window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("The gateway rejected this API key"),
			);
		});

		it.each([
			["the gateway cannot be reached", () => Promise.reject(new TypeError("fetch failed"))],
			["the gateway fails", () => Promise.resolve(new Response("", { status: 503 }))],
			[
				"a gateway rule refuses the request",
				() => Promise.resolve(new Response("", { status: 403 })),
			],
		])("stores the key unchecked when %s", async (_case, reply) => {
			fetchMock.mockImplementationOnce(reply);

			const session = await addApiKey("vck_offline");

			expect(session.accessToken).toBe("vck_offline");
			expect(await provider.getSessions()).toHaveLength(1);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Saving the API key unchecked"),
			);
			for (const call of vi.mocked(logger.warn).mock.calls) {
				expect(JSON.stringify(call)).not.toContain("vck_offline");
			}
		});
	});

	describe("environment API key", () => {
		const ENV_KEY = "vck_from_environment";

		function expectKeyNeverLogged() {
			for (const method of ["error", "warn", "info", "debug"] as const) {
				for (const call of vi.mocked(logger[method]).mock.calls) {
					expect(JSON.stringify(call)).not.toContain(ENV_KEY);
				}
			}
		}

		beforeEach(() => {
			vi.stubEnv("AI_GATEWAY_API_KEY", ` ${ENV_KEY}\n`);
		});

		it("serves the trimmed variable as the active session when none is stored", async () => {
			const active = await provider.getActiveSession();

			expect(active).toMatchObject({
				accessToken: ENV_KEY,
				method: "environment",
				account: { label: "AI_GATEWAY_API_KEY" },
			});
			expect((await provider.getSessions())[0]?.accessToken).toBe(ENV_KEY);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("https://gateway.test/v1/models");
			expect(init.headers).toEqual({ Authorization: `Bearer ${ENV_KEY}` });
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(ctx.secrets.store).not.toHaveBeenCalled();
			expect(window.withProgress).not.toHaveBeenCalled();
			expectKeyNeverLogged();
		});

		it("prefers a stored session over the variable", async () => {
			await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1")]));

			expect((await provider.getActiveSession())?.id).toBe("s1");
			const sessions = await provider.getSessions();
			expect(sessions.map((s) => s.id)).toEqual(["s1"]);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("ignores a key the gateway rejects with 401 and warns once", async () => {
			fetchMock.mockResolvedValue(new Response("", { status: 401 }));

			expect(await provider.getActiveSession()).toBeNull();
			expect(await provider.getSessions()).toEqual([]);

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(window.showWarningMessage).toHaveBeenCalledTimes(1);
			expect(window.showWarningMessage).toHaveBeenCalledWith(
				expect.stringContaining("rejected the API key in AI_GATEWAY_API_KEY (HTTP 401)"),
			);
			expectKeyNeverLogged();
		});

		it("uses the key unchecked when the gateway cannot be reached", async () => {
			fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

			expect((await provider.getActiveSession())?.accessToken).toBe(ENV_KEY);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Using AI_GATEWAY_API_KEY unchecked"),
			);
			expectKeyNeverLogged();
		});

		it("shows the environment session in the manage menu without a remove action", async () => {
			hoisted.mockShowQuickPick.mockResolvedValueOnce(undefined as never);

			await provider.manageAuthentication();

			const [options, pickOptions] = hoisted.mockShowQuickPick.mock.calls[0] as [
				Array<{ value: string }>,
				{ placeHolder: string },
			];
			expect(options.map((o) => o.value)).toEqual(["add", "cancel"]);
			expect(pickOptions.placeHolder).toContain("AI_GATEWAY_API_KEY [Environment]");
		});

		it("does not remove or store anything when asked to remove the environment session", async () => {
			const [session] = await provider.getSessions();

			await provider.removeSession(session?.id ?? "");

			expect(ctx.secrets.store).not.toHaveBeenCalled();
			expect(hoisted.mockEventEmitterFire).not.toHaveBeenCalled();
			expect((await provider.getActiveSession())?.accessToken).toBe(ENV_KEY);
		});

		it("makes a session added next to the variable the active one", async () => {
			hoisted.mockShowQuickPick
				.mockResolvedValueOnce({ label: "Add new authentication", value: "add" } as never)
				.mockResolvedValueOnce({ label: "API Key", value: "api-key" } as never);
			hoisted.mockShowInputBox.mockResolvedValueOnce("Work").mockResolvedValueOnce("vck_typed");

			await provider.manageAuthentication();

			expect((await provider.getActiveSession())?.accessToken).toBe("vck_typed");
			const stored = await ctx.secrets.get(SESSIONS_KEY);
			expect(stored).not.toContain(ENV_KEY);
		});
	});

	describe("accounts", () => {
		async function createApiKeySession(name: string, key: string) {
			hoisted.mockShowQuickPick.mockResolvedValueOnce({
				label: "API Key",
				value: "api-key",
			} as never);
			hoisted.mockShowInputBox.mockResolvedValueOnce(name).mockResolvedValueOnce(key);
			return provider.createSession([]);
		}

		it("declares support for multiple accounts", async () => {
			const { authentication } = await import("vscode");
			const options = vi
				.mocked(authentication.registerAuthenticationProvider)
				.mock.calls.at(-1)?.[3];

			expect(options).toMatchObject({ supportsMultipleAccounts: true });
		});

		it("gives every session its own account id", async () => {
			const first = await createApiKeySession("Work", "vck_work");
			const second = await createApiKeySession("Personal", "vck_personal");

			expect(first.account.id).not.toBe(second.account.id);
			expect(first.account.id).toBe(first.id);
			expect(second.account.label).toBe("Personal");
		});

		it("migrates sessions that shared a legacy account id", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([
					{ ...createSession("s1"), account: { id: "vercel-ai-user", label: "Work" } },
					{ ...createSession("s2"), account: { id: "vercel-ai-user", label: "Personal" } },
				]),
			);

			const sessions = await provider.getSessions();

			expect(sessions.map((s) => s.account.id).sort()).toEqual(["s1", "s2"]);
			expect(sessions.map((s) => s.account.label).sort()).toEqual(["Personal", "Work"]);
		});

		it("returns only the requested account's sessions", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([
					{ ...createSession("s1"), account: { id: "s1", label: "Work" } },
					{ ...createSession("s2"), account: { id: "s2", label: "Personal" } },
				]),
			);

			const sessions = await provider.getSessions(undefined, {
				account: { id: "s2", label: "Personal" },
			});

			expect(sessions.map((s) => s.id)).toEqual(["s2"]);
		});

		it("exposes the active session with its token", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([
					{ ...createSession("s1"), account: { id: "s1", label: "Work" } },
					{ ...createSession("s2"), account: { id: "s2", label: "Personal" } },
				]),
			);
			await ctx.globalState.update(ACTIVE_KEY, "s2");

			expect(await provider.getActiveSession()).toMatchObject({
				id: "s2",
				accessToken: "token",
				account: { id: "s2", label: "Personal" },
			});
		});

		it("has no active session when there are no sessions", async () => {
			expect(await provider.getActiveSession()).toBeNull();
		});

		it("follows the active session after a switch", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([
					{ ...createSession("s1"), account: { id: "s1", label: "Work" } },
					{ ...createSession("s2"), account: { id: "s2", label: "Personal" } },
				]),
			);
			await ctx.globalState.update(ACTIVE_KEY, "s1");

			hoisted.mockShowQuickPick
				.mockResolvedValueOnce({ label: "Switch active session", value: "switch" } as never)
				.mockResolvedValueOnce({ label: "Personal", value: "s2" } as never);
			await provider.manageAuthentication();

			expect(await provider.getActiveSession()).toMatchObject({ id: "s2" });
		});
	});
	describe("stored session parsing", () => {
		it("keeps valid sessions when a sibling entry has no account", async () => {
			const { account: _account, ...noAccount } = createSession("bad");
			await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1"), noAccount]));

			const sessions = await provider.getSessions();

			expect(sessions.map((s) => s.id)).toEqual(["s1"]);
			expect(ctx.secrets.delete).not.toHaveBeenCalled();
		});

		it("drops entries without a string id or access token", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([
					{ ...createSession("s1"), id: undefined },
					{ ...createSession("s2"), accessToken: 42 },
					createSession("s3"),
					null,
					"x",
				]),
			);

			const sessions = await provider.getSessions();

			expect(sessions.map((s) => s.id)).toEqual(["s3"]);
			expect(ctx.secrets.delete).not.toHaveBeenCalled();
		});

		it.each([
			["null", "null"],
			["an object", "{}"],
			["a string", '"x"'],
		])("returns no sessions when the blob parses to %s", async (_label, blob) => {
			await ctx.secrets.store(SESSIONS_KEY, blob);

			await expect(provider.getSessions()).resolves.toEqual([]);
			await expect(provider.getActiveSession()).resolves.toBeNull();
			expect(ctx.secrets.delete).not.toHaveBeenCalled();
		});

		it("still migrates legacy accounts and defaults the method next to a dropped entry", async () => {
			const { method: _method, ...noMethod } = createSession("s2");
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([
					{ ...createSession("s1"), account: { id: "vercel-ai-user", label: "Work" } },
					noMethod,
					{ ...createSession("bad"), account: null },
				]),
			);

			const sessions = await provider.getSessions();

			expect(sessions.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
			expect(sessions.find((s) => s.id === "s1")?.account.id).toBe("s1");
			await provider.removeSession("s1");
			const stored = JSON.parse((await ctx.secrets.get(SESSIONS_KEY)) ?? "[]");
			expect(stored).toEqual([expect.objectContaining({ id: "s2", method: "api-key" })]);
		});

		it("logs, warns once and deletes stored sessions that are not valid JSON", async () => {
			const warn = vi.spyOn(logger, "warn");
			const blob = '[{"id":"s1","accessToken":"secret-value"';
			await ctx.secrets.store(SESSIONS_KEY, blob);

			await expect(provider.getSessions()).resolves.toEqual([]);
			await provider.getSessions();
			await provider.removeSession("none");

			expect(ctx.secrets.delete).toHaveBeenCalledWith(SESSIONS_KEY);
			expect(warn).toHaveBeenCalledWith(
				`Stored sessions are not valid JSON (SyntaxError, length ${blob.length})`,
			);
			expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-value");
			expect(window.showWarningMessage).toHaveBeenCalledTimes(1);
			expect(window.showWarningMessage).toHaveBeenCalledWith(
				expect.stringContaining("must be added again"),
				"Manage Authentication",
			);
		});

		it("does not delete sessions stored after the unreadable value was read", async () => {
			await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1")]));
			vi.mocked(ctx.secrets.get).mockResolvedValueOnce("invalid{");

			await expect(provider.getSessions()).resolves.toEqual([]);
			await provider.removeSession("none");

			expect(ctx.secrets.delete).not.toHaveBeenCalled();
			const sessions = await provider.getSessions();
			expect(sessions.map((s) => s.id)).toEqual(["s1"]);
		});

		it("opens authentication management from the warning", async () => {
			vi.mocked(window.showWarningMessage).mockResolvedValueOnce("Manage Authentication" as never);
			const manage = vi.spyOn(provider, "manageAuthentication").mockResolvedValue();
			await ctx.secrets.store(SESSIONS_KEY, "invalid{");

			await provider.getSessions();
			await vi.waitFor(() => expect(manage).toHaveBeenCalledTimes(1));
		});

		it("warns when the stored value is not an array", async () => {
			const warn = vi.spyOn(logger, "warn");
			await ctx.secrets.store(SESSIONS_KEY, '{"id":"s1"}');

			await provider.getSessions();

			expect(warn).toHaveBeenCalledWith("Stored sessions are not an array (object)");
			expect(window.showWarningMessage).toHaveBeenCalledTimes(1);
		});

		it("warns about one bad entry and keeps the good ones", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([createSession("s1"), { id: "bad" }, createSession("s2")]),
			);

			const sessions = await provider.getSessions();

			expect(sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
			expect(window.showWarningMessage).toHaveBeenCalledTimes(1);
		});

		it("does not warn when every stored session is valid", async () => {
			await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1")]));

			await provider.getSessions();

			expect(window.showWarningMessage).not.toHaveBeenCalled();
		});

		it("keeps the other valid session when removing one next to a bad entry", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([createSession("s1"), { id: "bad" }, createSession("s2")]),
			);

			await provider.removeSession("s1");

			const stored = JSON.parse((await ctx.secrets.get(SESSIONS_KEY)) ?? "[]");
			expect(stored.map((s: { id: string }) => s.id)).toEqual(["s2"]);
			expect(ctx.secrets.delete).not.toHaveBeenCalled();
		});
	});

	describe("signed in context key", () => {
		function signedInValues() {
			return hoisted.mockExecuteCommand.mock.calls
				.filter(([command, key]) => command === "setContext" && key === "vercelAiGateway.signedIn")
				.map(([, , value]) => value);
		}

		function sessionChangeListener() {
			const listener = vi.mocked(provider.onDidChangeSessions).mock.calls[0]?.[0];
			if (!listener) {
				throw new Error("watchSignedInContext did not subscribe to session changes");
			}
			return listener;
		}

		it("is false with no session and true once one is stored", async () => {
			provider.watchSignedInContext();
			await vi.waitFor(() => expect(signedInValues()).toEqual([false]));

			await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1")]));
			sessionChangeListener()({ added: [], removed: [], changed: [] });

			await vi.waitFor(() => expect(signedInValues()).toEqual([false, true]));
		});

		it("turns false after the last session is removed", async () => {
			await ctx.secrets.store(SESSIONS_KEY, JSON.stringify([createSession("s1")]));
			provider.watchSignedInContext();
			await vi.waitFor(() => expect(signedInValues()).toEqual([true]));

			await provider.removeSession("s1");
			sessionChangeListener()({ added: [], removed: [], changed: [] });

			await vi.waitFor(() => expect(signedInValues()).toEqual([true, false]));
		});

		it("is true for an AI_GATEWAY_API_KEY session", async () => {
			vi.stubEnv("AI_GATEWAY_API_KEY", "vck_from_environment");

			provider.watchSignedInContext();

			await vi.waitFor(() => expect(signedInValues()).toEqual([true]));
		});

		it("keeps the value of the latest session change when an earlier read finishes last", async () => {
			let releaseFirstRead: (value: string) => void = () => {};
			vi.mocked(ctx.secrets.get).mockImplementationOnce(
				() => new Promise((resolve) => (releaseFirstRead = resolve)),
			);

			provider.watchSignedInContext();
			sessionChangeListener()({ added: [], removed: [], changed: [] });
			await vi.waitFor(() => expect(signedInValues()).toEqual([false]));
			releaseFirstRead(JSON.stringify([createSession("s1")]));

			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(signedInValues()).toEqual([false]);
		});
	});
});
