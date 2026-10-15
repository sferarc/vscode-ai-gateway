import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { showInformationMessage, showErrorMessage, logInfo, logShow } = vi.hoisted(() => ({
	showInformationMessage: vi.fn(),
	showErrorMessage: vi.fn(),
	logInfo: vi.fn(),
	logShow: vi.fn(),
}));

vi.mock("vscode", () => ({
	workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn((_, d) => d), inspect: vi.fn() })) },
	window: { showInformationMessage, showErrorMessage },
}));

vi.mock("./logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("./logger")>()),
	logger: { info: logInfo, error: vi.fn(), warn: vi.fn(), debug: vi.fn(), show: logShow },
}));

import { DEFAULT_BASE_URL } from "./constants";
import { checkConnection, type DiagnosticsSession, runConnectionCheck } from "./diagnostics";

const TOKEN = "vck_secret_token_value";

const apiKeySession: DiagnosticsSession = {
	accessToken: TOKEN,
	account: { label: "Work" },
	method: "api-key",
};

function mockFetch(impl: () => Promise<unknown>) {
	const fetchMock = vi.fn(impl);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function everythingShown(): string {
	return JSON.stringify([
		showInformationMessage.mock.calls,
		showErrorMessage.mock.calls,
		logInfo.mock.calls,
	]);
}

describe("checkConnection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("reports status, latency and model count on success", async () => {
		const fetchMock = mockFetch(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
			json: async () => ({ data: [{ id: "a" }, { id: "b" }, { id: "c" }] }),
		}));

		const result = await checkConnection(apiKeySession, DEFAULT_BASE_URL, 1000);

		expect(fetchMock).toHaveBeenCalledWith(
			`${DEFAULT_BASE_URL}/v1/models`,
			expect.objectContaining({ headers: { Authorization: `Bearer ${TOKEN}` } }),
		);
		expect(result).toMatchObject({
			ok: true,
			endpoint: DEFAULT_BASE_URL,
			session: { label: "Work", method: "api-key" },
			status: 200,
			modelCount: 3,
		});
		expect(result.latencyMs).toBeGreaterThanOrEqual(0);
		expect(result.error).toBeUndefined();
	});

	it("reports the OIDC token expiry", async () => {
		mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }));
		const expiresAt = Date.UTC(2026, 9, 15, 12, 0, 0);

		const result = await checkConnection(
			{ ...apiKeySession, method: "oidc", oidcData: { expiresAt } },
			DEFAULT_BASE_URL,
			1000,
		);

		expect(result.session).toEqual({ label: "Work", method: "oidc", expiresAt });
	});

	it("explains a 401 as rejected credentials", async () => {
		mockFetch(async () => ({ ok: false, status: 401, statusText: "Unauthorized" }));

		const result = await checkConnection(apiKeySession, DEFAULT_BASE_URL, 1000);

		expect(result.ok).toBe(false);
		expect(result.status).toBe(401);
		expect(result.modelCount).toBeUndefined();
		expect(result.error).toMatch(/rejected the session's credentials/);
	});

	it("reports a network failure without a status", async () => {
		mockFetch(async () => {
			throw new TypeError("fetch failed");
		});

		const result = await checkConnection(apiKeySession, DEFAULT_BASE_URL, 1000);

		expect(result.ok).toBe(false);
		expect(result.status).toBeUndefined();
		expect(result.error).toBe("fetch failed");
	});

	it("does not send a request without a session", async () => {
		const fetchMock = mockFetch(async () => ({ ok: true }));

		const result = await checkConnection(null, DEFAULT_BASE_URL, 1000);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.ok).toBe(false);
		expect(result.session).toBeUndefined();
		expect(result.error).toMatch(/No active session/);
	});
});

describe("runConnectionCheck", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("shows and logs the result without the token, and opens the log on request", async () => {
		mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: [{}] }) }));
		showInformationMessage.mockResolvedValue("Show Logs");

		await runConnectionCheck(async () => apiKeySession);

		expect(showInformationMessage).toHaveBeenCalledWith(
			expect.stringContaining("Models: 1"),
			"Show Logs",
		);
		expect(logInfo).toHaveBeenCalledWith(expect.stringContaining(`Endpoint: ${DEFAULT_BASE_URL}`));
		expect(logShow).toHaveBeenCalled();
		expect(everythingShown()).not.toContain(TOKEN);
	});

	it("shows an error message and leaves the log closed when dismissed", async () => {
		mockFetch(async () => ({ ok: false, status: 401, statusText: "Unauthorized" }));
		showErrorMessage.mockResolvedValue(undefined);

		await runConnectionCheck(async () => apiKeySession);

		expect(showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("HTTP status: 401"),
			"Show Logs",
		);
		expect(showInformationMessage).not.toHaveBeenCalled();
		expect(logShow).not.toHaveBeenCalled();
		expect(everythingShown()).not.toContain(TOKEN);
	});

	it("reports a session lookup failure", async () => {
		const fetchMock = mockFetch(async () => ({ ok: true }));

		await runConnectionCheck(async () => {
			throw new Error("secret storage unavailable");
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("secret storage unavailable"),
			"Show Logs",
		);
	});
});
