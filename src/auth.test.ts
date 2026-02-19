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
import { refreshOidcToken } from "./vercel-auth";

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
});
