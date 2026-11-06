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

function mockFetch(impl: (url?: unknown) => Promise<unknown>) {
	const fetchMock = vi.fn(impl);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function routeFetch(credits: () => Promise<unknown>) {
	return mockFetch(async (url?: unknown) =>
		String(url).endsWith("/v1/credits")
			? credits()
			: { ok: true, status: 200, json: async () => ({ data: [{ id: "a" }] }) },
	);
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
			chatModelCount: 3,
		});
		expect(result.latencyMs).toBeGreaterThanOrEqual(0);
		expect(result.error).toBeUndefined();
	});

	it("counts only the chat models the picker offers apart from the total", async () => {
		mockFetch(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				data: [
					{ id: "openai/gpt-5", type: "language" },
					{ id: "openai/gpt-5-batch", type: "language" },
					{ id: "legacy/chat", type: "chat" },
					{ id: "untyped/model" },
					{ id: "openai/text-embedding-3-small", type: "embedding" },
					{ id: "google/imagen-4.0-generate-001", type: "image" },
					null,
				],
			}),
		}));

		const result = await checkConnection(apiKeySession, DEFAULT_BASE_URL, 1000);

		expect(result).toMatchObject({ ok: true, modelCount: 7, chatModelCount: 3 });
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

	it("reports the credit balance after the model list", async () => {
		const fetchMock = routeFetch(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ balance: "12.34", total_used: "5.66" }),
		}));

		const result = await checkConnection(apiKeySession, DEFAULT_BASE_URL, 1000);

		expect(fetchMock).toHaveBeenCalledWith(
			`${DEFAULT_BASE_URL}/v1/credits`,
			expect.objectContaining({ headers: { Authorization: `Bearer ${TOKEN}` } }),
		);
		expect(result).toMatchObject({
			ok: true,
			modelCount: 1,
			credits: { balance: "12.34", totalUsed: "5.66" },
		});
	});

	it.each([
		["a refused request", async () => ({ ok: false, status: 403, statusText: "Forbidden" })],
		["a body without amounts", async () => ({ ok: true, status: 200, json: async () => ({}) })],
		["a null body", async () => ({ ok: true, status: 200, json: async () => null })],
		[
			"a network failure",
			async () => {
				throw new TypeError("fetch failed");
			},
		],
	])("still passes without a balance after %s", async (_, credits) => {
		routeFetch(credits);

		const result = await checkConnection(apiKeySession, DEFAULT_BASE_URL, 1000);

		expect(result).toMatchObject({ ok: true, modelCount: 1 });
		expect(result.credits).toBeUndefined();
		expect(result.error).toBeUndefined();
	});

	it("does not ask for the balance or the spend when the model list fails", async () => {
		const fetchMock = mockFetch(async () => ({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
		}));

		await checkConnection(apiKeySession, DEFAULT_BASE_URL, 1000);

		expect(fetchMock).toHaveBeenCalledTimes(1);
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

describe("month spend in the check", () => {
	const report = [
		{ model: "openai/gpt-5", total_cost: 0.75, request_count: 10 },
		{ model: "anthropic/claude-sonnet-4.5", total_cost: 2.5, request_count: 40 },
	];

	function routeReport(answer: () => Promise<unknown>) {
		return mockFetch(async (url?: unknown) => {
			if (String(url).includes("/v1/report?")) return answer();
			if (String(url).endsWith("/v1/credits")) return { ok: false, status: 404 };
			return { ok: true, status: 200, json: async () => ({ data: [{ id: "a" }] }) };
		});
	}

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("reads the spend since the first of the month by model", async () => {
		const fetchMock = routeReport(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ results: report }),
		}));

		const result = await checkConnection(apiKeySession, DEFAULT_BASE_URL, 1000);

		expect(fetchMock).toHaveBeenCalledWith(
			`${DEFAULT_BASE_URL}/v1/report?start_date=2026-11-01&end_date=2026-11-05&group_by=model`,
			expect.objectContaining({ headers: { Authorization: `Bearer ${TOKEN}` } }),
		);
		expect(result).toMatchObject({
			ok: true,
			spend: {
				since: "2026-11-01",
				totalCost: 3.25,
				requestCount: 50,
				topModels: [
					{ model: "anthropic/claude-sonnet-4.5", totalCost: 2.5 },
					{ model: "openai/gpt-5", totalCost: 0.75 },
				],
			},
		});
	});

	it.each([
		["a refused request", async () => ({ ok: false, status: 403 })],
		["a body without results", async () => ({ ok: true, status: 200, json: async () => ({}) })],
		[
			"a network failure",
			async () => {
				throw new TypeError("fetch failed");
			},
		],
	])("still passes without a spend after %s", async (_, answer) => {
		routeReport(answer);

		const result = await checkConnection(apiKeySession, DEFAULT_BASE_URL, 1000);

		expect(result).toMatchObject({ ok: true, modelCount: 1 });
		expect(result.spend).toBeUndefined();
		expect(result.error).toBeUndefined();
	});

	it("shows and logs the spend line without the token", async () => {
		routeReport(async () => ({ ok: true, status: 200, json: async () => ({ results: report }) }));

		await runConnectionCheck(async () => apiKeySession);

		const line =
			"Spend this month (since 2026-11-01 UTC): $3.25 over 50 requests. Most spent on: anthropic/claude-sonnet-4.5 $2.50, openai/gpt-5 $0.75";
		expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining(line), "Show Logs");
		expect(logInfo).toHaveBeenCalledWith(expect.stringContaining(line));
		expect(everythingShown()).not.toContain(TOKEN);
	});

	it("leaves the spend line out when the report is unreadable", async () => {
		routeReport(async () => ({ ok: false, status: 500 }));

		await runConnectionCheck(async () => apiKeySession);

		expect(everythingShown()).not.toContain("Spend this month");
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
			expect.stringContaining("Chat models: 1 of 1 listed"),
			"Show Logs",
		);
		expect(logInfo).toHaveBeenCalledWith(expect.stringContaining(`Endpoint: ${DEFAULT_BASE_URL}`));
		expect(logShow).toHaveBeenCalled();
		expect(everythingShown()).not.toContain(TOKEN);
	});

	it("shows the credit balance", async () => {
		routeFetch(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ balance: "12.34", total_used: "5.66" }),
		}));

		await runConnectionCheck(async () => apiKeySession);

		expect(showInformationMessage).toHaveBeenCalledWith(
			expect.stringContaining("Credits: 12.34 left, 5.66 used"),
			"Show Logs",
		);
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
