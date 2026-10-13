import * as fs from "node:fs";
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

vi.mock("node:fs", () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }));
vi.mock("node:os", () => ({ platform: vi.fn(), homedir: vi.fn() }));
vi.mock("vscode", () => ({
	window: { showQuickPick: vi.fn(), showInputBox: vi.fn(), showErrorMessage: vi.fn() },
}));

const originalFetch = globalThis.fetch;

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
		globalThis.fetch = originalFetch;
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
			globalThis.fetch = vi.fn();
			const { refreshOidcToken } = await import("./vercel-auth");

			const result = await refreshOidcToken({ ...storedToken, expiresAt: Date.now() + 3600000 });
			expect(globalThis.fetch).not.toHaveBeenCalled();
			expect(result.token).toBe("old");
		});

		it("refreshes expired token and parses JWT exp", async () => {
			const exp = Math.floor(Date.now() / 1000) + 3600;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: createJwt({ exp }) }),
			});

			const { refreshOidcToken } = await import("./vercel-auth");
			const result = await refreshOidcToken({ ...storedToken, expiresAt: Date.now() - 1000 });

			expect(globalThis.fetch).toHaveBeenCalled();
			expect(result.expiresAt).toBe(exp * 1000);
		});

		it("handles JWT without exp field gracefully", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
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
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, statusText: "Unauthorized" });
			const { refreshOidcToken } = await import("./vercel-auth");

			await expect(
				refreshOidcToken({ ...storedToken, expiresAt: Date.now() - 1000 }),
			).rejects.toThrow("Failed to refresh OIDC token");
		});

		it("preserves the team across a refresh", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
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
			globalThis.fetch = fetchMock;
			const { refreshOidcToken } = await import("./vercel-auth");

			await refreshOidcToken({ ...storedToken, expiresAt: Date.now() - 1000, teamId: "team_abc" });

			expect(String(fetchMock.mock.calls[0][0])).toContain("teamId=team_abc");
		});

		it("rejects a response whose token is not a JWT", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: "not-a-jwt" }),
			});
			const { refreshOidcToken } = await import("./vercel-auth");

			await expect(
				refreshOidcToken({ ...storedToken, expiresAt: Date.now() - 1000 }),
			).rejects.toThrow("Invalid JWT token");
		});

		it("rejects a response with no token field", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
			const { refreshOidcToken } = await import("./vercel-auth");

			await expect(
				refreshOidcToken({ ...storedToken, expiresAt: Date.now() - 1000 }),
			).rejects.toThrow("Invalid token response");
		});

		it("falls back to a one-hour expiry when exp is not a number", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
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

	describe("createInteractiveOidcSession", () => {
		type QuickPickItems = Array<{ label: string; value: unknown }>;

		function jsonResponse(body: unknown) {
			return { ok: true, status: 200, statusText: "", json: () => Promise.resolve(body) };
		}

		function projectsPage(names: string[], next: number | null) {
			return jsonResponse({
				projects: names.map((name) => ({ id: `prj_${name}`, name })),
				pagination: { count: names.length, next, prev: null },
			});
		}

		function requestUrl(fetchMock: ReturnType<typeof vi.fn>, index: number): URL {
			return new URL(String(fetchMock.mock.calls[index][0]));
		}

		function pickTeam(team: unknown) {
			vi.mocked(vscode.window.showQuickPick).mockImplementation((async (items: QuickPickItems) => {
				if (items[0]?.label === "Personal Account") {
					return items.find((item) => item.value === team) ?? items[0];
				}
				return undefined;
			}) as never);
		}

		function projectPickItems(): QuickPickItems {
			const calls = vi.mocked(vscode.window.showQuickPick).mock.calls;
			return calls[calls.length - 1][0] as unknown as QuickPickItems;
		}

		beforeEach(() => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: "cli" }));
			pickTeam(null);
		});

		it("offers projects from every page and passes pagination.next as until", async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce(jsonResponse({ teams: [], pagination: { next: null } }))
				.mockResolvedValueOnce(projectsPage(["a", "b"], 1700000000000))
				.mockResolvedValueOnce(projectsPage(["c"], null));
			globalThis.fetch = fetchMock;
			const { createInteractiveOidcSession } = await import("./vercel-auth");

			await expect(createInteractiveOidcSession()).rejects.toThrow("Project selection is required");

			expect(fetchMock).toHaveBeenCalledTimes(3);
			expect(requestUrl(fetchMock, 1).searchParams.get("until")).toBeNull();
			expect(requestUrl(fetchMock, 1).searchParams.get("limit")).toBe("100");
			expect(requestUrl(fetchMock, 2).searchParams.get("until")).toBe("1700000000000");
			expect(projectPickItems().map((item) => item.label)).toEqual(["a", "b", "c"]);
		});

		it("offers teams from every page", async () => {
			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(
					jsonResponse({
						teams: [{ id: "t1", name: "One", slug: "one" }],
						pagination: { next: 5 },
					}),
				)
				.mockResolvedValueOnce(
					jsonResponse({
						teams: [{ id: "t2", name: "Two", slug: "two" }],
						pagination: { next: null },
					}),
				)
				.mockResolvedValueOnce(projectsPage([], null));
			const { createInteractiveOidcSession } = await import("./vercel-auth");

			await expect(createInteractiveOidcSession()).rejects.toThrow("Project selection is required");

			const teamItems = vi.mocked(vscode.window.showQuickPick).mock
				.calls[0][0] as unknown as QuickPickItems;
			expect(teamItems.map((item) => item.label)).toEqual(["Personal Account", "One", "Two"]);
		});

		it("stops at the page cap when pagination.next never ends", async () => {
			const fetchMock = vi.fn().mockImplementation(async (input: URL | string) => {
				const url = new URL(String(input));
				if (url.pathname === "/v2/teams") {
					return jsonResponse({ teams: [], pagination: { next: null } });
				}
				return projectsPage(["p"], 1);
			});
			globalThis.fetch = fetchMock;
			const { createInteractiveOidcSession } = await import("./vercel-auth");

			await expect(createInteractiveOidcSession()).rejects.toThrow("Project selection is required");

			expect(fetchMock).toHaveBeenCalledTimes(1 + 20);
			expect(projectPickItems()).toHaveLength(20);
		});

		it("encodes a teamId that contains reserved characters", async () => {
			const team = { id: "team&x=1", name: "Odd", slug: "odd" };
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce(jsonResponse({ teams: [team], pagination: { next: null } }))
				.mockResolvedValueOnce(projectsPage([], null));
			globalThis.fetch = fetchMock;
			vi.mocked(vscode.window.showQuickPick).mockImplementation((async (items: QuickPickItems) =>
				items[0]?.label === "Personal Account" ? items[1] : undefined) as never);
			const { createInteractiveOidcSession } = await import("./vercel-auth");

			await expect(createInteractiveOidcSession()).rejects.toThrow("Project selection is required");

			const url = requestUrl(fetchMock, 1);
			expect(url.search).toContain("teamId=team%26x%3D1");
			expect(url.searchParams.get("teamId")).toBe("team&x=1");
			expect(url.searchParams.has("x")).toBe(false);
		});

		it("includes the HTTP status when statusText is empty", async () => {
			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(jsonResponse({ teams: [], pagination: { next: null } }))
				.mockResolvedValueOnce({ ok: false, status: 403, statusText: "" });
			const { createInteractiveOidcSession } = await import("./vercel-auth");

			await expect(createInteractiveOidcSession()).rejects.toThrow(
				"Failed to load projects: Failed to fetch projects: 403",
			);
		});
	});
});
