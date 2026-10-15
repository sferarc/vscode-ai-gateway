import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const getConfiguration = vi.hoisted(() => vi.fn());

vi.mock("vscode", () => ({ workspace: { getConfiguration } }));

import { getConfig } from "./config";
import { DEFAULT_BASE_URL } from "./constants";

function settings(endpoint: {
	globalValue?: string;
	workspaceValue?: string;
	workspaceFolderValue?: string;
}) {
	const effective =
		endpoint.workspaceFolderValue ?? endpoint.workspaceValue ?? endpoint.globalValue;
	return {
		get: vi.fn((key: string, d: unknown) => (key === "endpoint" ? (effective ?? d) : d)),
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
