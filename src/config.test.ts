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

describe("getConfig reportingUser", () => {
	function attributed(scopes: { globalValue?: unknown; workspaceValue?: unknown }) {
		return {
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn((key: string) => (key === "reportingUser" ? { key, ...scopes } : undefined)),
		};
	}

	it("trims the user's ID and keeps its case", () => {
		getConfiguration.mockReturnValue(attributed({ globalValue: "  Dev-Ana  " }));

		expect(getConfig().reportingUser).toBe("Dev-Ana");
	});

	it("keeps a 256 character ID and drops a longer one", () => {
		getConfiguration.mockReturnValue(attributed({ globalValue: "a".repeat(256) }));
		expect(getConfig().reportingUser).toBe("a".repeat(256));

		getConfiguration.mockReturnValue(attributed({ globalValue: "a".repeat(257) }));
		expect(getConfig().reportingUser).toBeUndefined();
	});

	it("ignores an ID set in workspace settings", () => {
		getConfiguration.mockReturnValue(attributed({ workspaceValue: "someone-else" }));

		expect(getConfig().reportingUser).toBeUndefined();
	});

	it.each([[""], ["   "], [undefined], [42], [["dev"]]])("sends no user for %o", (value) => {
		getConfiguration.mockReturnValue(attributed({ globalValue: value }));

		expect(getConfig().reportingUser).toBeUndefined();
	});

	it("declares an application scoped empty string in the manifest", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.reportingUser"],
		).toMatchObject({
			type: "string",
			maxLength: 256,
			scope: "application",
			default: "",
		});
	});
});

describe("getConfig quotaEntity", () => {
	function entity(scopes: { globalValue?: unknown; workspaceValue?: unknown }) {
		return {
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn((key: string) => (key === "quotaEntity" ? { key, ...scopes } : undefined)),
		};
	}

	it("trims the entity ID and keeps its case", () => {
		getConfiguration.mockReturnValue(entity({ globalValue: "  Project-Docs  " }));

		expect(getConfig().quotaEntity).toBe("Project-Docs");
	});

	it("ignores an entity set in workspace settings", () => {
		getConfiguration.mockReturnValue(entity({ workspaceValue: "someone-else" }));

		expect(getConfig().quotaEntity).toBeUndefined();
	});

	it.each([[""], ["   "], [undefined], [42], [["project"]]])("sends no entity for %o", (value) => {
		getConfiguration.mockReturnValue(entity({ globalValue: value }));

		expect(getConfig().quotaEntity).toBeUndefined();
	});

	it("declares an application scoped empty string in the manifest", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.quotaEntity"],
		).toMatchObject({ type: "string", scope: "application", default: "" });
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

describe("getConfig inferenceRegion", () => {
	function pinned(scopes: { globalValue?: unknown; workspaceValue?: unknown }) {
		return {
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn((key: string) => (key === "inferenceRegion" ? { key, ...scopes } : undefined)),
		};
	}

	it.each([["us"], ["eu"], ["au"], ["jp"]])("passes the %s region through", (value) => {
		getConfiguration.mockReturnValue(pinned({ globalValue: value }));

		expect(getConfig().inferenceRegion).toBe(value);
	});

	it.each([["global"], [undefined], ["EU"], ["apac"], [1], [null]])(
		"lets the gateway pick the region for %o",
		(value) => {
			getConfiguration.mockReturnValue(pinned({ globalValue: value }));

			expect(getConfig().inferenceRegion).toBeUndefined();
		},
	);

	it("ignores a region set in workspace settings", () => {
		getConfiguration.mockReturnValue(pinned({ workspaceValue: "eu" }));

		expect(getConfig().inferenceRegion).toBeUndefined();
	});

	it("declares an application scoped global default and the gateway's four regions", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.inferenceRegion"],
		).toMatchObject({
			type: "string",
			scope: "application",
			default: "global",
			enum: ["global", "us", "eu", "au", "jp"],
		});
	});
});

describe("getConfig excludeQuantizations", () => {
	function excluding(scopes: { globalValue?: unknown; workspaceValue?: unknown }) {
		return {
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn((key: string) =>
				key === "excludeQuantizations" ? { key, ...scopes } : undefined,
			),
		};
	}

	it("lowercases and trims the user's formats and keeps their order", () => {
		getConfiguration.mockReturnValue(excluding({ globalValue: [" FP8 ", "int4", "q4_k.m-1"] }));

		expect(getConfig().excludeQuantizations).toEqual(["fp8", "int4", "q4_k.m-1"]);
	});

	it("drops repeated, non-string and formats the gateway would refuse", () => {
		getConfiguration.mockReturnValue(
			excluding({
				globalValue: ["fp8", "Fp8", 4, null, "", "!quantization:fp8", "fp 8", "x".repeat(33)],
			}),
		);

		expect(getConfig().excludeQuantizations).toEqual(["fp8"]);
	});

	it("ignores formats set in workspace settings", () => {
		getConfiguration.mockReturnValue(excluding({ workspaceValue: ["fp8"] }));

		expect(getConfig().excludeQuantizations).toBeUndefined();
	});

	it.each([[[]], [undefined], ["fp8"], [["", 1]]])("excludes nothing for %o", (value) => {
		getConfiguration.mockReturnValue(excluding({ globalValue: value }));

		expect(getConfig().excludeQuantizations).toBeUndefined();
	});

	it("declares an application scoped empty list of gateway formats in the manifest", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.excludeQuantizations"],
		).toMatchObject({
			type: "array",
			items: { type: "string", pattern: "^[a-zA-Z0-9._-]{1,32}$" },
			scope: "application",
			default: [],
		});
	});
});

describe("getConfig serviceTier", () => {
	function tiered(scopes: { globalValue?: unknown; workspaceValue?: unknown }) {
		return {
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn((key: string) => (key === "serviceTier" ? { key, ...scopes } : undefined)),
		};
	}

	it.each([["flex"], ["priority"]])("passes the %s tier through", (value) => {
		getConfiguration.mockReturnValue(tiered({ globalValue: value }));

		expect(getConfig().serviceTier).toBe(value);
	});

	it.each([["default"], [undefined], ["Priority"], ["fast"], ["ultrafast"], [1], [null]])(
		"leaves the standard tier for %o",
		(value) => {
			getConfiguration.mockReturnValue(tiered({ globalValue: value }));

			expect(getConfig().serviceTier).toBeUndefined();
		},
	);

	it("ignores a tier set in workspace settings", () => {
		getConfiguration.mockReturnValue(tiered({ workspaceValue: "priority" }));

		expect(getConfig().serviceTier).toBeUndefined();
	});

	it("declares an application scoped default tier and the gateway's two tiers", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.serviceTier"],
		).toMatchObject({
			type: "string",
			scope: "application",
			default: "default",
			enum: ["default", "flex", "priority"],
		});
	});
});

describe("getConfig requiredCapabilities", () => {
	function requiring(scopes: { globalValue?: unknown; workspaceValue?: unknown }) {
		return {
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn((key: string) =>
				key === "requiredCapabilities" ? { key, ...scopes } : undefined,
			),
		};
	}

	it("keeps the user's capabilities in order", () => {
		getConfiguration.mockReturnValue(requiring({ globalValue: ["vision", "tool-use", "free"] }));

		expect(getConfig().requiredCapabilities).toEqual(["vision", "tool-use", "free"]);
	});

	it("drops repeated, non-string and capabilities the gateway would refuse", () => {
		getConfiguration.mockReturnValue(
			requiring({
				globalValue: [
					"reasoning",
					"reasoning",
					1,
					null,
					"",
					"Vision",
					" tool-use",
					"quantization:fp8",
				],
			}),
		);

		expect(getConfig().requiredCapabilities).toEqual(["reasoning"]);
	});

	it("ignores capabilities set in workspace settings", () => {
		getConfiguration.mockReturnValue(requiring({ workspaceValue: ["free"] }));

		expect(getConfig().requiredCapabilities).toBeUndefined();
	});

	it.each([[[]], [undefined], ["free"], [["", 1]]])("requires nothing for %o", (value) => {
		getConfiguration.mockReturnValue(requiring({ globalValue: value }));

		expect(getConfig().requiredCapabilities).toBeUndefined();
	});

	it("declares an application scoped empty list of the gateway's capabilities in the manifest", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.requiredCapabilities"],
		).toMatchObject({
			type: "array",
			items: {
				type: "string",
				enum: ["free", "implicit-caching", "reasoning", "structured-output", "tool-use", "vision"],
			},
			scope: "application",
			default: [],
		});
	});
});

describe("getConfig reasoningEffort", () => {
	function effort(scopes: { globalValue?: unknown; workspaceValue?: unknown }) {
		return {
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn((key: string) => (key === "reasoningEffort" ? { key, ...scopes } : undefined)),
		};
	}

	it.each([["none"], ["minimal"], ["low"], ["medium"], ["high"], ["xhigh"], ["max"]])(
		"passes the %s effort through",
		(value) => {
			getConfiguration.mockReturnValue(effort({ globalValue: value }));

			expect(getConfig().reasoningEffort).toBe(value);
		},
	);

	it.each([["provider-default"], [undefined], ["High"], ["extreme"], [3], [null]])(
		"leaves the provider's reasoning for %o",
		(value) => {
			getConfiguration.mockReturnValue(effort({ globalValue: value }));

			expect(getConfig().reasoningEffort).toBeUndefined();
		},
	);

	it("ignores an effort set in workspace settings", () => {
		getConfiguration.mockReturnValue(effort({ workspaceValue: "max" }));

		expect(getConfig().reasoningEffort).toBeUndefined();
	});

	it("declares an application scoped provider default and the AI SDK's effort levels", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		const setting =
			manifest.contributes.configuration.properties["vercelAiGateway.reasoningEffort"];
		expect(setting).toMatchObject({
			type: "string",
			scope: "application",
			default: "provider-default",
			enum: ["provider-default", "none", "minimal", "low", "medium", "high", "xhigh", "max"],
		});
		expect(setting.enumDescriptions).toHaveLength(setting.enum.length);
	});
});

describe("getConfig sessionAffinity", () => {
	function affinity(scopes: { globalValue?: unknown; workspaceValue?: unknown }) {
		return {
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn((key: string) => (key === "sessionAffinity" ? { key, ...scopes } : undefined)),
		};
	}

	it("turns session affinity off when the user sets false", () => {
		getConfiguration.mockReturnValue(affinity({ globalValue: false }));

		expect(getConfig().sessionAffinity).toBe(false);
	});

	it.each([[true], [undefined], ["false"], [0], [null]])(
		"keeps session affinity on for %o",
		(value) => {
			getConfiguration.mockReturnValue(affinity({ globalValue: value }));

			expect(getConfig().sessionAffinity).toBe(true);
		},
	);

	it("ignores false set in workspace settings", () => {
		getConfiguration.mockReturnValue(affinity({ workspaceValue: false }));

		expect(getConfig().sessionAffinity).toBe(true);
	});

	it("declares an application scoped boolean that is on by default", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.sessionAffinity"],
		).toMatchObject({ type: "boolean", scope: "application", default: true });
	});
});

describe("getConfig webSearch", () => {
	function search(scopes: { globalValue?: unknown; workspaceValue?: unknown }) {
		return {
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn((key: string) => (key === "webSearch" ? { key, ...scopes } : undefined)),
		};
	}

	it("turns web search on when the user sets true", () => {
		getConfiguration.mockReturnValue(search({ globalValue: true }));

		expect(getConfig().webSearch).toBe(true);
	});

	it.each([[false], [undefined], ["true"], [1], [null]])("keeps web search off for %o", (value) => {
		getConfiguration.mockReturnValue(search({ globalValue: value }));

		expect(getConfig().webSearch).toBe(false);
	});

	it("ignores true set in workspace settings", () => {
		getConfiguration.mockReturnValue(search({ workspaceValue: true }));

		expect(getConfig().webSearch).toBe(false);
	});

	it("declares an application scoped boolean that is off by default", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.webSearch"],
		).toMatchObject({
			type: "boolean",
			scope: "application",
			default: false,
		});
	});
});

describe("getConfig byokProviderTimeouts", () => {
	function timeouts(scopes: { globalValue?: unknown; workspaceValue?: unknown }) {
		return {
			get: vi.fn((_: string, d: unknown) => d),
			inspect: vi.fn((key: string) =>
				key === "byokProviderTimeouts" ? { key, ...scopes } : undefined,
			),
		};
	}

	it("reads the user's timeouts per provider slug", () => {
		getConfiguration.mockReturnValue(
			timeouts({ globalValue: { anthropic: 10000, bedrock: 15000 } }),
		);

		expect(getConfig().byokProviderTimeouts).toEqual({ anthropic: 10000, bedrock: 15000 });
	});

	it("lowercases and trims slugs, rounds and clamps values and drops the rest", () => {
		getConfiguration.mockReturnValue(
			timeouts({
				globalValue: {
					" OpenAI ": 2500.4,
					anthropic: 10,
					vertex: 10_000_000,
					bedrock: "5000",
					groq: Number.NaN,
					"  ": 5000,
				},
			}),
		);

		expect(getConfig().byokProviderTimeouts).toEqual({
			openai: 2500,
			anthropic: 1000,
			vertex: 789000,
		});
	});

	it.each([[undefined], [{}], [[5000]], ["anthropic"], [null], [{ anthropic: "fast" }]])(
		"sends no timeouts for %o",
		(value) => {
			getConfiguration.mockReturnValue(timeouts({ globalValue: value }));

			expect(getConfig().byokProviderTimeouts).toBeUndefined();
		},
	);

	it("ignores timeouts set in workspace settings", () => {
		getConfiguration.mockReturnValue(timeouts({ workspaceValue: { anthropic: 1000 } }));

		expect(getConfig().byokProviderTimeouts).toBeUndefined();
	});

	it("declares an application scoped object of bounded numbers", () => {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(
			manifest.contributes.configuration.properties["vercelAiGateway.byokProviderTimeouts"],
		).toMatchObject({
			type: "object",
			scope: "application",
			default: {},
			additionalProperties: { type: "number", minimum: 1000, maximum: 789000 },
		});
	});
});
