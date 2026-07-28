import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	mockEventEmitterFire: vi.fn(),
	MockEventEmitter: class {
		event = vi.fn();
		fire = hoisted.mockEventEmitterFire;
		dispose = vi.fn();
	},
	mockShowQuickPick: vi.fn(),
	mockShowInputBox: vi.fn(),
}));

vi.mock("vscode", () => ({
	EventEmitter: hoisted.MockEventEmitter,
	authentication: { registerAuthenticationProvider: vi.fn(() => ({ dispose: vi.fn() })) },
	window: {
		showInputBox: hoisted.mockShowInputBox,
		showQuickPick: hoisted.mockShowQuickPick,
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
	},
}));

vi.mock("./vercel-auth", () => ({
	checkVercelCliAvailable: vi.fn(() => false),
	createInteractiveOidcSession: vi.fn(),
	refreshOidcToken: vi.fn(),
}));

import type { ExtensionContext } from "vscode";
import { VercelAIAuthenticationProvider } from "./auth";
import { checkVercelCliAvailable, refreshOidcToken } from "./vercel-auth";

const SESSIONS_KEY = "vercelAiGateway.sessions";
const ACTIVE_KEY = "vercelAiGateway.activeSession";

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
					expiresAt: expiresAt ?? Date.now() + 3600000,
				},
			}
		: base;
}

describe("VercelAIAuthenticationProvider", () => {
	let ctx: ExtensionContext;
	let provider: VercelAIAuthenticationProvider;

	beforeEach(() => {
		vi.clearAllMocks();
		ctx = createMockContext();
		provider = new VercelAIAuthenticationProvider(ctx);
	});

	it("returns empty sessions when none exist", async () => {
		expect(await provider.getSessions()).toEqual([]);
	});

	it("returns stored sessions", async () => {
		await ctx.secrets.store("vercelAiGateway.sessions", JSON.stringify([createSession("s1")]));
		const sessions = await provider.getSessions();
		expect(sessions).toHaveLength(1);
		expect(sessions[0].id).toBe("s1");
	});

	it("refreshes near-expiry OIDC tokens and fires change event", async () => {
		const session = createSession("s1", "oidc", Date.now() + 5 * 60 * 1000);
		await ctx.secrets.store("vercelAiGateway.sessions", JSON.stringify([session]));

		vi.mocked(refreshOidcToken).mockResolvedValueOnce({
			token: "new_token",
			expiresAt: Date.now() + 3600000,
			projectId: "p1",
			projectName: "P",
			teamId: "t1",
			teamName: "T",
		});

		const sessions = await provider.getSessions();
		expect(refreshOidcToken).toHaveBeenCalled();
		expect(sessions[0].accessToken).toBe("new_token");
		expect(hoisted.mockEventEmitterFire).toHaveBeenCalled();
	});

	it("returns original session when refresh fails", async () => {
		const session = createSession("s1", "oidc", Date.now() + 5 * 60 * 1000);
		await ctx.secrets.store("vercelAiGateway.sessions", JSON.stringify([session]));
		vi.mocked(refreshOidcToken).mockRejectedValueOnce(new Error("fail"));

		const sessions = await provider.getSessions();
		expect(sessions[0].accessToken).toBe("token");
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

			expect(sessions[0].id).toBe("s3");
		});

		it("persists a refreshed OIDC token so later reads see it", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([createSession("s1", "oidc", Date.now() + 60 * 1000)]),
			);
			vi.mocked(refreshOidcToken).mockResolvedValueOnce({
				token: "fresh",
				expiresAt: Date.now() + 3600000,
				projectId: "p1",
				projectName: "P",
				teamId: "t1",
				teamName: "T",
			});

			await provider.getSessions();

			const stored = JSON.parse((await ctx.secrets.get(SESSIONS_KEY)) ?? "[]");
			expect(stored[0].accessToken).toBe("fresh");
		});

		it("keeps other sessions when one OIDC refresh fails", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([createSession("s1", "oidc", Date.now() + 60 * 1000), createSession("s2")]),
			);
			vi.mocked(refreshOidcToken).mockRejectedValueOnce(new Error("boom"));

			const sessions = await provider.getSessions();

			expect(sessions.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
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

			const options = hoisted.mockShowQuickPick.mock.calls[0][0] as Array<{ value: string }>;
			expect(options.map((o) => o.value)).not.toContain("switch");
		});
	});

	describe("authentication method options", () => {
		it("offers only API key when the Vercel CLI is not logged in", async () => {
			vi.mocked(checkVercelCliAvailable).mockReturnValue(false);
			hoisted.mockShowQuickPick.mockResolvedValueOnce(undefined as never);

			await provider.createSession([]).catch(() => undefined);

			const options = hoisted.mockShowQuickPick.mock.calls[0][0] as Array<{ value: string }>;
			expect(options.map((o) => o.value)).toEqual(["api-key"]);
		});

		it("also offers OIDC when the Vercel CLI is logged in", async () => {
			vi.mocked(checkVercelCliAvailable).mockReturnValue(true);
			hoisted.mockShowQuickPick.mockResolvedValueOnce(undefined as never);

			await provider.createSession([]).catch(() => undefined);

			const options = hoisted.mockShowQuickPick.mock.calls[0][0] as Array<{ value: string }>;
			expect(options.map((o) => o.value)).toEqual(["api-key", "oidc"]);
		});

		it("rejects an API key that is not a vck_ key", async () => {
			hoisted.mockShowQuickPick.mockResolvedValueOnce({
				label: "API Key",
				value: "api-key",
			} as never);
			hoisted.mockShowInputBox.mockResolvedValueOnce("Name").mockResolvedValueOnce("vck_ok");

			await provider.createSession([]);

			const apiKeyPrompt = hoisted.mockShowInputBox.mock.calls[1][0] as {
				validateInput: (value: string) => string | null;
			};
			expect(apiKeyPrompt.validateInput("wrong")).toMatch(/vck_/);
			expect(apiKeyPrompt.validateInput("vck_good")).toBeNull();
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

		it("exposes the active session's account", async () => {
			await ctx.secrets.store(
				SESSIONS_KEY,
				JSON.stringify([
					{ ...createSession("s1"), account: { id: "s1", label: "Work" } },
					{ ...createSession("s2"), account: { id: "s2", label: "Personal" } },
				]),
			);
			await ctx.globalState.update(ACTIVE_KEY, "s2");

			expect(await provider.getActiveAccount()).toMatchObject({ id: "s2", label: "Personal" });
		});

		it("has no active account when there are no sessions", async () => {
			expect(await provider.getActiveAccount()).toBeUndefined();
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

			expect(await provider.getActiveAccount()).toMatchObject({ id: "s2" });
		});
	});
});
