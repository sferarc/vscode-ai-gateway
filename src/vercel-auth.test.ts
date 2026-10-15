import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { TOKEN_REFRESH_MARGIN } from "./constants";

vi.mock("node:fs", () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }));
vi.mock("node:os", () => ({ platform: vi.fn(), homedir: vi.fn() }));
vi.mock("vscode", () => ({
	window: { showQuickPick: vi.fn(), showInputBox: vi.fn(), showErrorMessage: vi.fn() },
}));

const originalFetch = globalThis.fetch;
const NOW = new Date("2026-01-01T00:00:00Z").getTime();

function createJwt(payload: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${header}.${body}.sig`;
}

describe("vercel-auth", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
		vi.resetAllMocks();
		vi.mocked(os.platform).mockReturnValue("darwin");
		vi.mocked(os.homedir).mockReturnValue("/Users/test");
	});

	afterEach(() => {
		vi.useRealTimers();
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

			const result = await refreshOidcToken({ ...storedToken, expiresAt: NOW + 3600000 });
			expect(globalThis.fetch).not.toHaveBeenCalled();
			expect(result.token).toBe("old");
		});

		it("refreshes expired token and parses JWT exp", async () => {
			const exp = NOW / 1000 + 3600;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: createJwt({ exp }) }),
			});

			const { refreshOidcToken } = await import("./vercel-auth");
			const result = await refreshOidcToken({ ...storedToken, expiresAt: NOW - 1000 });

			expect(globalThis.fetch).toHaveBeenCalled();
			expect(result.expiresAt).toBe(exp * 1000);
		});

		it("handles JWT without exp field gracefully", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: createJwt({ sub: "user" }) }),
			});

			const { refreshOidcToken } = await import("./vercel-auth");
			const result = await refreshOidcToken({ ...storedToken, expiresAt: NOW - 1000 });

			expect(result.expiresAt).toBe(NOW + 60 * 60 * 1000);
		});

		it("throws when CLI not logged in", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);
			const { refreshOidcToken } = await import("./vercel-auth");

			await expect(refreshOidcToken({ ...storedToken, expiresAt: NOW - 1000 })).rejects.toThrow(
				"Vercel CLI not logged in",
			);
		});

		it("throws on API error", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, statusText: "Unauthorized" });
			const { refreshOidcToken } = await import("./vercel-auth");

			await expect(refreshOidcToken({ ...storedToken, expiresAt: NOW - 1000 })).rejects.toThrow(
				"Failed to refresh OIDC token",
			);
		});

		it("preserves the team across a refresh", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: createJwt({ exp: NOW / 1000 + 3600 }) }),
			});
			const { refreshOidcToken } = await import("./vercel-auth");

			const result = await refreshOidcToken({
				...storedToken,
				expiresAt: NOW - 1000,
				teamId: "t1",
				teamName: "Team One",
			});

			expect(result).toMatchObject({ teamId: "t1", teamName: "Team One" });
		});

		it("scopes the refresh request to the team when one is set", async () => {
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: createJwt({ exp: NOW / 1000 + 3600 }) }),
			});
			globalThis.fetch = fetchMock;
			const { refreshOidcToken } = await import("./vercel-auth");

			await refreshOidcToken({ ...storedToken, expiresAt: NOW - 1000, teamId: "team_abc" });

			expect(String(fetchMock.mock.calls[0]?.[0])).toContain("teamId=team_abc");
		});

		it("rejects a response whose token is not a JWT", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: "not-a-jwt" }),
			});
			const { refreshOidcToken } = await import("./vercel-auth");

			await expect(refreshOidcToken({ ...storedToken, expiresAt: NOW - 1000 })).rejects.toThrow(
				"Invalid JWT token",
			);
		});

		it("rejects a response with no token field", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
			const { refreshOidcToken } = await import("./vercel-auth");

			await expect(refreshOidcToken({ ...storedToken, expiresAt: NOW - 1000 })).rejects.toThrow(
				"Invalid token response",
			);
		});

		it("falls back to a one-hour expiry when exp is not a number", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: createJwt({ exp: "not-a-number" }) }),
			});
			const { refreshOidcToken } = await import("./vercel-auth");

			const result = await refreshOidcToken({ ...storedToken, expiresAt: NOW - 1000 });

			expect(result.expiresAt).toBe(NOW + 60 * 60 * 1000);
		});

		it("reports the CLI as unavailable when auth.json has no token", async () => {
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ notToken: "x" }));
			const { checkVercelCliAvailable } = await import("./vercel-auth");

			expect(checkVercelCliAvailable()).toBe(false);
		});
	});

	describe("Vercel CLI token location", () => {
		const envKeys = ["XDG_DATA_HOME", "APPDATA", "LOCALAPPDATA"] as const;
		let savedEnv: Record<string, string | undefined>;

		beforeEach(() => {
			savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
			for (const key of envKeys) {
				delete process.env[key];
			}
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: "t" }));
		});

		afterEach(() => {
			for (const key of envKeys) {
				if (savedEnv[key] === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = savedEnv[key];
				}
			}
		});

		async function expectAuthJsonAt(expected: string) {
			const { checkVercelCliAvailable } = await import("./vercel-auth");
			expect(checkVercelCliAvailable()).toBe(true);
			expect(fs.existsSync).toHaveBeenCalledWith(expected);
			expect(fs.readFileSync).toHaveBeenCalledWith(expected, "utf8");
		}

		it.each(["darwin", "linux", "win32"] as const)("uses XDG_DATA_HOME on %s", async (platform) => {
			vi.mocked(os.platform).mockReturnValue(platform);
			process.env.XDG_DATA_HOME = "/xdg/data";
			process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
			await expectAuthJsonAt(path.join("/xdg/data", "com.vercel.cli", "auth.json"));
		});

		it("uses Application Support on darwin", async () => {
			await expectAuthJsonAt(
				path.join("/Users/test", "Library", "Application Support", "com.vercel.cli", "auth.json"),
			);
		});

		it("uses ~/.local/share on linux", async () => {
			vi.mocked(os.platform).mockReturnValue("linux");
			vi.mocked(os.homedir).mockReturnValue("/home/test");
			await expectAuthJsonAt(
				path.join("/home/test", ".local", "share", "com.vercel.cli", "auth.json"),
			);
		});

		it("uses APPDATA\\xdg.data on win32, not LOCALAPPDATA", async () => {
			vi.mocked(os.platform).mockReturnValue("win32");
			process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
			process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
			await expectAuthJsonAt(
				path.join("C:\\Users\\test\\AppData\\Roaming", "xdg.data", "com.vercel.cli", "auth.json"),
			);
		});

		it("falls back to AppData/Roaming under the home directory on win32 without APPDATA", async () => {
			vi.mocked(os.platform).mockReturnValue("win32");
			vi.mocked(os.homedir).mockReturnValue("C:\\Users\\test");
			await expectAuthJsonAt(
				path.join(
					"C:\\Users\\test",
					"AppData",
					"Roaming",
					"xdg.data",
					"com.vercel.cli",
					"auth.json",
				),
			);
		});

		it("uses the linux layout on other platforms such as freebsd", async () => {
			vi.mocked(os.platform).mockReturnValue("freebsd");
			vi.mocked(os.homedir).mockReturnValue("/home/test");
			await expectAuthJsonAt(
				path.join("/home/test", ".local", "share", "com.vercel.cli", "auth.json"),
			);
		});

		it.each([
			["an empty token", { token: "" }],
			["a numeric token", { token: 123 }],
			["no token", {}],
			["null", null],
		])("reports the CLI as unavailable for auth.json with %s", async (_label, authJson) => {
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(authJson));
			const { checkVercelCliAvailable } = await import("./vercel-auth");
			expect(checkVercelCliAvailable()).toBe(false);
		});

		it("does not send a numeric auth.json token as the bearer token", async () => {
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: 123 }));
			globalThis.fetch = vi.fn();
			const { refreshOidcToken } = await import("./vercel-auth");

			await expect(
				refreshOidcToken({ token: "old", expiresAt: 0, projectId: "p1", projectName: "P" }),
			).rejects.toThrow("Vercel CLI not logged in");
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});
	});

	describe("refresh margin", () => {
		const storedToken = { token: "old", projectId: "p1", projectName: "P" };

		beforeEach(() => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: "cli" }));
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ token: createJwt({ exp: NOW / 1000 + 3600 }) }),
			});
		});

		it("keeps a token that expires exactly TOKEN_REFRESH_MARGIN from now", async () => {
			const { refreshOidcToken } = await import("./vercel-auth");
			const result = await refreshOidcToken({
				...storedToken,
				expiresAt: NOW + TOKEN_REFRESH_MARGIN,
			});
			expect(globalThis.fetch).not.toHaveBeenCalled();
			expect(result.token).toBe("old");
		});

		it("refreshes a token that expires one millisecond inside the margin", async () => {
			const { refreshOidcToken } = await import("./vercel-auth");
			await refreshOidcToken({ ...storedToken, expiresAt: NOW + TOKEN_REFRESH_MARGIN - 1 });
			expect(globalThis.fetch).toHaveBeenCalledOnce();
		});

		it("refreshes a token that has already expired", async () => {
			const { refreshOidcToken } = await import("./vercel-auth");
			await refreshOidcToken({ ...storedToken, expiresAt: NOW - 1 });
			expect(globalThis.fetch).toHaveBeenCalledOnce();
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
			return new URL(String(fetchMock.mock.calls[index]?.[0]));
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
			return calls.at(-1)?.[0] as unknown as QuickPickItems;
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
				.calls[0]?.[0] as unknown as QuickPickItems;
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

		it("reports a dismissed team picker as a cancellation", async () => {
			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(jsonResponse({ teams: [], pagination: { next: null } }));
			vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined as never);
			const { createInteractiveOidcSession } = await import("./vercel-auth");

			await expect(createInteractiveOidcSession()).rejects.toMatchObject({
				name: "AuthCancelledError",
				message: "Team selection cancelled",
			});
		});

		it("reports a dismissed project picker as a cancellation", async () => {
			globalThis.fetch = vi
				.fn()
				.mockResolvedValueOnce(jsonResponse({ teams: [], pagination: { next: null } }))
				.mockResolvedValueOnce(projectsPage(["a"], null));
			const { createInteractiveOidcSession } = await import("./vercel-auth");

			await expect(createInteractiveOidcSession()).rejects.toMatchObject({
				name: "AuthCancelledError",
			});
		});
	});
});
