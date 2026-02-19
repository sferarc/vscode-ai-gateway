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
	});
});
