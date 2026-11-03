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

	it("trims spaces and trailing slashes from the user's endpoint", () => {
		getConfiguration.mockReturnValue(settings({ globalValue: "  https://gateway.example.com// " }));

		expect(getConfig().endpoint).toBe("https://gateway.example.com");
	});

	it.each([
		["https://ai-gateway.vercel.sh/v1"],
		["https://ai-gateway.vercel.sh/v1/"],
		["https://ai-gateway.vercel.sh/v4/ai"],
		["https://ai-gateway.vercel.sh/V1/AI/"],
	])("drops the API version a base URL copied from Vercel's docs ends in: %s", (value) => {
		getConfiguration.mockReturnValue(settings({ globalValue: value }));

		expect(getConfig().endpoint).toBe("https://ai-gateway.vercel.sh");
	});

	it.each([["https://gateway.example.com/v1beta"], ["https://gateway.example.com/v1/proxy"]])(
		"keeps a path that is not a bare API version: %s",
		(value) => {
			getConfiguration.mockReturnValue(settings({ globalValue: value }));

			expect(getConfig().endpoint).toBe(value);
		},
	);

	it.each([[""], ["   "], ["/"], [42], [null], [{}]])(
		"falls back to the default endpoint for %j",
		(value) => {
			getConfiguration.mockReturnValue(settings({ globalValue: value as string }));

			expect(getConfig().endpoint).toBe(DEFAULT_BASE_URL);
		},
	);

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

describe.each([["disallowPromptTraining"], ["zeroDataRetention"]] as const)(
	"getConfig %s",
	(setting) => {
		function filter(values: {
			globalValue?: unknown;
			workspaceValue?: unknown;
			workspaceFolderValue?: unknown;
		}) {
			return {
				get: vi.fn((_: string, d: unknown) => d),
				inspect: vi.fn((key: string) =>
					key === setting ? { key, defaultValue: false, ...values } : undefined,
				),
			};
		}

		it("is off by default", () => {
			getConfiguration.mockReturnValue(filter({}));

			expect(getConfig()[setting]).toBe(false);
		});

		it.each([
			[{ globalValue: true }],
			[{ workspaceValue: true }],
			[{ workspaceFolderValue: true }],
		])("is on when any scope turns it on: %o", (values) => {
			getConfiguration.mockReturnValue(filter(values));

			expect(getConfig()[setting]).toBe(true);
		});

		it("stays on when a workspace sets it to false over the user's true", () => {
			getConfiguration.mockReturnValue(filter({ globalValue: true, workspaceValue: false }));

			expect(getConfig()[setting]).toBe(true);
		});

		it.each([["true"], [1], [null]])("ignores the non boolean value %o", (value) => {
			getConfiguration.mockReturnValue(filter({ globalValue: value }));

			expect(getConfig()[setting]).toBe(false);
		});

		it("is declared off by default in the manifest", () => {
			const manifest = JSON.parse(
				readFileSync(new URL("../package.json", import.meta.url), "utf8"),
			);
			expect(
				manifest.contributes.configuration.properties[`vercelAiGateway.${setting}`],
			).toMatchObject({ type: "boolean", default: false });
		});
	},
);

describe("getConfig providerSort", () => {
	function sorted(value: unknown) {
		return {
			get: vi.fn((key: string, d: unknown) => (key === "providerSort" ? value : d)),
			inspect: vi.fn(() => undefined),
		};
	}

	it.each([["cost"], ["ttft"], ["tps"]])("passes the %s sort through", (value) => {
		getConfiguration.mockReturnValue(sorted(value));

		expect(getConfig().providerSort).toBe(value);
	});

	it.each([["default"], [undefined], ["COST"], ["latency"], [1], [null]])(
		"leaves the gateway's ranking for %o",
		(value) => {
			getConfiguration.mockReturnValue(sorted(value));

			expect(getConfig().providerSort).toBeUndefined();
		},
	);

	it("declares default and the gateway's three sorts in the manifest", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.providerSort"],
		).toMatchObject({
			type: "string",
			default: "default",
			enum: ["default", "cost", "ttft", "tps"],
		});
	});
});

describe("getConfig providerOrder", () => {
	function ordered(value: unknown) {
		return {
			get: vi.fn((key: string, d: unknown) => (key === "providerOrder" ? value : d)),
			inspect: vi.fn(() => undefined),
		};
	}

	it("passes the provider slugs through in order", () => {
		getConfiguration.mockReturnValue(ordered(["bedrock", "anthropic"]));

		expect(getConfig().providerOrder).toEqual(["bedrock", "anthropic"]);
	});

	it("trims, lowercases and drops empty, repeated and non-string entries", () => {
		getConfiguration.mockReturnValue(ordered([" Vertex ", "", 3, null, "vertex", "ANTHROPIC"]));

		expect(getConfig().providerOrder).toEqual(["vertex", "anthropic"]);
	});

	it.each([[[]], [undefined], ["bedrock"], [[" ", 1]], [{ order: ["bedrock"] }]])(
		"leaves the gateway's ranking for %o",
		(value) => {
			getConfiguration.mockReturnValue(ordered(value));

			expect(getConfig().providerOrder).toBeUndefined();
		},
	);

	it("declares an empty list of strings in the manifest", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.providerOrder"],
		).toMatchObject({ type: "array", items: { type: "string" }, default: [] });
	});
});

describe("getConfig providerOnly", () => {
	function restricted(scopes: {
		globalValue?: unknown;
		workspaceValue?: unknown;
		workspaceFolderValue?: unknown;
	}) {
		return {
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn((key: string) => (key === "providerOnly" ? { key, ...scopes } : undefined)),
		};
	}

	it("restricts requests to the user's provider slugs", () => {
		getConfiguration.mockReturnValue(restricted({ globalValue: [" Anthropic ", "vertex", 2] }));

		expect(getConfig().providerOnly).toEqual(["anthropic", "vertex"]);
	});

	it("ignores a list set in workspace or folder settings", () => {
		getConfiguration.mockReturnValue(
			restricted({
				globalValue: ["anthropic"],
				workspaceValue: ["openai"],
				workspaceFolderValue: ["xai"],
			}),
		);
		expect(getConfig().providerOnly).toEqual(["anthropic"]);

		getConfiguration.mockReturnValue(restricted({ workspaceValue: ["openai"] }));
		expect(getConfig().providerOnly).toBeUndefined();
	});

	it.each([[[]], [undefined], ["anthropic"], [["", null]]])("restricts nothing for %o", (value) => {
		getConfiguration.mockReturnValue(restricted({ globalValue: value }));

		expect(getConfig().providerOnly).toBeUndefined();
	});

	it("declares an application scoped empty list of strings in the manifest", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.providerOnly"],
		).toMatchObject({
			type: "array",
			items: { type: "string" },
			scope: "application",
			default: [],
		});
	});
});

describe("getConfig reportingTags", () => {
	function tagged(scopes: { globalValue?: unknown; workspaceValue?: unknown }) {
		return {
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn((key: string) => (key === "reportingTags" ? { key, ...scopes } : undefined)),
		};
	}

	it("trims the user's tags and keeps their case", () => {
		getConfiguration.mockReturnValue(tagged({ globalValue: [" team:Platform ", "tool:vscode"] }));

		expect(getConfig().reportingTags).toEqual(["team:Platform", "tool:vscode"]);
	});

	it("drops empty, repeated, non-string and over 64 character tags and keeps the first 10", () => {
		const many = Array.from({ length: 12 }, (_, i) => `t${i}`);
		getConfiguration.mockReturnValue(
			tagged({ globalValue: ["", " ", 3, null, "a".repeat(65), "a".repeat(64), "t0", ...many] }),
		);

		expect(getConfig().reportingTags).toEqual(["a".repeat(64), ...many.slice(0, 9)]);
	});

	it("ignores tags set in workspace settings", () => {
		getConfiguration.mockReturnValue(tagged({ workspaceValue: ["repo:cloned"] }));

		expect(getConfig().reportingTags).toBeUndefined();
	});

	it.each([[[]], [undefined], ["team:platform"], [["", 1]]])("sends no tags for %o", (value) => {
		getConfiguration.mockReturnValue(tagged({ globalValue: value }));

		expect(getConfig().reportingTags).toBeUndefined();
	});

	it("declares an application scoped empty list of strings in the manifest", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.reportingTags"],
		).toMatchObject({
			type: "array",
			items: { type: "string", minLength: 1, maxLength: 64 },
			maxItems: 10,
			scope: "application",
			default: [],
		});
	});
});

describe("getConfig fallbackModels", () => {
	function withFallbacks(scopes: { globalValue?: unknown; workspaceValue?: unknown }) {
		return {
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn((key: string) => (key === "fallbackModels" ? { key, ...scopes } : undefined)),
		};
	}

	it("trims the user's model ids and keeps their order", () => {
		getConfiguration.mockReturnValue(
			withFallbacks({ globalValue: [" openai/gpt-5 ", "anthropic/claude-sonnet-4.5"] }),
		);

		expect(getConfig().fallbackModels).toEqual(["openai/gpt-5", "anthropic/claude-sonnet-4.5"]);
	});

	it("drops empty, repeated and non-string entries", () => {
		getConfiguration.mockReturnValue(
			withFallbacks({ globalValue: ["", " ", 3, null, "openai/gpt-5", "openai/gpt-5 "] }),
		);

		expect(getConfig().fallbackModels).toEqual(["openai/gpt-5"]);
	});

	it("ignores fallback models set in workspace settings", () => {
		getConfiguration.mockReturnValue(withFallbacks({ workspaceValue: ["openai/gpt-5"] }));

		expect(getConfig().fallbackModels).toBeUndefined();
	});

	it.each([[[]], [undefined], ["openai/gpt-5"], [["", 1]]])(
		"sends no fallbacks for %o",
		(value) => {
			getConfiguration.mockReturnValue(withFallbacks({ globalValue: value }));

			expect(getConfig().fallbackModels).toBeUndefined();
		},
	);

	it("declares an application scoped empty list of strings in the manifest", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.fallbackModels"],
		).toMatchObject({
			type: "array",
			items: { type: "string" },
			scope: "application",
			default: [],
		});
	});
});
