import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const getConfiguration = vi.hoisted(() => vi.fn());

vi.mock("vscode", () => ({ workspace: { getConfiguration } }));

import { getConfig } from "./config";
import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS } from "./constants";

function settings(
	endpoint: {
		globalValue?: string;
		workspaceValue?: string;
		workspaceFolderValue?: string;
	},
	timeout?: unknown,
) {
	const effective =
		endpoint.workspaceFolderValue ?? endpoint.workspaceValue ?? endpoint.globalValue;
	return {
		get: vi.fn((key: string, d: unknown) => {
			if (key === "endpoint") return effective ?? d;
			if (key === "timeout") return timeout === undefined ? d : timeout;
			return d;
		}),
		inspect: vi.fn((key: string) =>
			key === "endpoint" ? { key, defaultValue: DEFAULT_BASE_URL, ...endpoint } : undefined,
		),
	};
}

describe("getConfig endpoint", () => {
	it("ignores an endpoint set in workspace or folder settings", () => {
		getConfiguration.mockReturnValue(
			settings({
				workspaceValue: "https://attacker.example",
				workspaceFolderValue: "https://attacker.example",
			}),
		);

		expect(getConfig().endpoint).toBe(DEFAULT_BASE_URL);
	});

	it("keeps the user's own endpoint when a workspace tries to override it", () => {
		getConfiguration.mockReturnValue(
			settings({
				globalValue: "https://gateway.example.com/",
				workspaceValue: "https://attacker.example",
			}),
		);

		expect(getConfig().endpoint).toBe("https://gateway.example.com");
	});

	it("declares the endpoint setting machine scoped so VS Code never reads it from a workspace", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

		expect(manifest.contributes.configuration.properties["vercelAiGateway.endpoint"].scope).toBe(
			"machine",
		);
	});
});

describe("getConfig timeout", () => {
	const manifestTimeout = () =>
		JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).contributes
			.configuration.properties["vercelAiGateway.timeout"];

	it("uses the default when the setting is unset", () => {
		getConfiguration.mockReturnValue(settings({}));

		expect(getConfig().timeout).toBe(DEFAULT_TIMEOUT_MS);
	});

	it("keeps a value inside the range", () => {
		getConfiguration.mockReturnValue(settings({}, 60000));

		expect(getConfig().timeout).toBe(60000);
	});

	it.each([
		[0, MIN_TIMEOUT_MS],
		[-1, MIN_TIMEOUT_MS],
		[100, MIN_TIMEOUT_MS],
		[10_000_000, MAX_TIMEOUT_MS],
	])("clamps %s from settings.json to %s", (value, expected) => {
		getConfiguration.mockReturnValue(settings({}, value));

		expect(getConfig().timeout).toBe(expected);
	});

	it.each([["60000"], [null], [Number.NaN], [Number.POSITIVE_INFINITY], [{}]])(
		"falls back to the default for %s",
		(value) => {
			getConfiguration.mockReturnValue(settings({}, value));

			expect(getConfig().timeout).toBe(DEFAULT_TIMEOUT_MS);
		},
	);

	it("clamps to the range and default the manifest declares", () => {
		expect(manifestTimeout()).toMatchObject({
			default: DEFAULT_TIMEOUT_MS,
			minimum: MIN_TIMEOUT_MS,
			maximum: MAX_TIMEOUT_MS,
		});
	});
});
