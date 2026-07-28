import * as fs from "node:fs";
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }));
vi.mock("node:os", () => ({ platform: vi.fn(), homedir: vi.fn() }));
vi.mock("vscode", () => ({
	window: { showQuickPick: vi.fn(), showInputBox: vi.fn(), showErrorMessage: vi.fn() },
}));

const originalFetch = global.fetch;

function createJwt(payload: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${header}.${body}.sig`;
}

describe("vercel-auth", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(os.platform).mockReturnValue("darwin");
		vi.mocked(os.homedir).mockReturnValue("/Users/test");
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	describe("checkVercelCliAvailable", () => {
		it("returns true when CLI token exists, false otherwise", async () => {
			const { checkVercelCliAvailable } = await import("./vercel-auth");

			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: "t" }));
			expect(checkVercelCliAvailable()).toBe(true);

			vi.mocked(fs.existsSync).mockReturnValue(false);
			expect(checkVercelCliAvailable()).toBe(false);

			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue("invalid{");
			expect(checkVercelCliAvailable()).toBe(false);
		});
	});

	describe("refreshOidcToken", () => {
		const storedToken = { token: "old", expiresAt: 0, projectId: "p1", projectName: "P" };

		beforeEach(() => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: "cli" }));
		});

		it("skips refresh when token not expired", async () => {
			global.fetch = vi.fn();
			const { refreshOidcToken } = await import("./vercel-auth");

			const result = await refreshOidcToken({ ...storedToken, expiresAt: Date.now() + 3600000 });
			expect(global.fetch).not.toHaveBeenCalled();
			expect(result.token).toBe("old");
		});

		it("refreshes expired token and parses JWT exp", async () => {
			const exp = Math.floor(Date.now() / 1000) + 3600;
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: createJwt({ exp }) }),
			});

			const { refreshOidcToken } = await import("./vercel-auth");
			const result = await refreshOidcToken({ ...storedToken, expiresAt: Date.now() - 1000 });

			expect(global.fetch).toHaveBeenCalled();
			expect(result.expiresAt).toBe(exp * 1000);
		});

		it("handles JWT without exp field gracefully", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: createJwt({ sub: "user" }) }),
			});

			const { refreshOidcToken } = await import("./vercel-auth");
			const result = await refreshOidcToken({ ...storedToken, expiresAt: Date.now() - 1000 });

			expect(Number.isNaN(result.expiresAt)).toBe(false);
			expect(result.expiresAt).toBeGreaterThan(Date.now());
		});

		it("throws when CLI not logged in", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);
			const { refreshOidcToken } = await import("./vercel-auth");

			await expect(
				refreshOidcToken({ ...storedToken, expiresAt: Date.now() - 1000 }),
			).rejects.toThrow("Vercel CLI not logged in");
		});

		it("throws on API error", async () => {
			global.fetch = vi.fn().mockResolvedValue({ ok: false, statusText: "Unauthorized" });
			const { refreshOidcToken } = await import("./vercel-auth");

			await expect(
				refreshOidcToken({ ...storedToken, expiresAt: Date.now() - 1000 }),
			).rejects.toThrow("Failed to refresh OIDC token");
		});

		it("preserves the team across a refresh", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({ token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }) }),
			});
			const { refreshOidcToken } = await import("./vercel-auth");

			const result = await refreshOidcToken({
				...storedToken,
				expiresAt: Date.now() - 1000,
				teamId: "t1",
				teamName: "Team One",
			});

			expect(result).toMatchObject({ teamId: "t1", teamName: "Team One" });
		});

		it("scopes the refresh request to the team when one is set", async () => {
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({ token: createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }) }),
			});
			global.fetch = fetchMock;
			const { refreshOidcToken } = await import("./vercel-auth");

			await refreshOidcToken({ ...storedToken, expiresAt: Date.now() - 1000, teamId: "team_abc" });

			expect(String(fetchMock.mock.calls[0][0])).toContain("teamId=team_abc");
		});

		it("rejects a response whose token is not a JWT", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: "not-a-jwt" }),
			});
			const { refreshOidcToken } = await import("./vercel-auth");

			await expect(
				refreshOidcToken({ ...storedToken, expiresAt: Date.now() - 1000 }),
			).rejects.toThrow("Invalid JWT token");
		});

		it("rejects a response with no token field", async () => {
			global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
			const { refreshOidcToken } = await import("./vercel-auth");

			await expect(
				refreshOidcToken({ ...storedToken, expiresAt: Date.now() - 1000 }),
			).rejects.toThrow("Invalid token response");
		});

		it("falls back to a one-hour expiry when exp is not a number", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: createJwt({ exp: "not-a-number" }) }),
			});
			const { refreshOidcToken } = await import("./vercel-auth");

			const before = Date.now();
			const result = await refreshOidcToken({ ...storedToken, expiresAt: Date.now() - 1000 });

			expect(result.expiresAt).toBeGreaterThan(before);
			expect(result.expiresAt).toBeLessThanOrEqual(before + 60 * 60 * 1000 + 1000);
		});

		it("reports the CLI as unavailable when auth.json has no token", async () => {
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ notToken: "x" }));
			const { checkVercelCliAvailable } = await import("./vercel-auth");

			expect(checkVercelCliAvailable()).toBe(false);
		});
	});
});
