import * as vscode from "vscode";
import {
	DEFAULT_BASE_URL,
	DEFAULT_TIMEOUT_MS,
	EXTENSION_ID,
	MAX_TIMEOUT_MS,
	MIN_TIMEOUT_MS,
} from "./constants";

export function getConfig() {
	const config = vscode.workspace.getConfiguration(EXTENSION_ID);
	// The endpoint receives the user's credentials, so a cloned repo's workspace settings must not redirect it.
	return {
		endpoint: normalisedEndpoint(config.inspect<unknown>("endpoint")?.globalValue),
		timeout: boundedTimeout(config.get<unknown>("timeout", DEFAULT_TIMEOUT_MS)),
		disallowPromptTraining: anyScopeEnabled(config.inspect<unknown>("disallowPromptTraining")),
		zeroDataRetention: anyScopeEnabled(config.inspect<unknown>("zeroDataRetention")),
		providerSort: providerSort(config.get<unknown>("providerSort")),
		providerOrder: providerSlugs(config.get<unknown>("providerOrder")),
		// A cloned repo's list could fail every request or move spend to another provider account.
		providerOnly: providerSlugs(config.inspect<unknown>("providerOnly")?.globalValue),
		// The gateway bills each tag, so a cloned repo must not add charges to the user's account.
		reportingTags: reportingTags(config.inspect<unknown>("reportingTags")?.globalValue),
		// The gateway bills each user ID too, and a cloned repo must not attribute the user's spend to someone else.
		reportingUser: reportingUser(config.inspect<unknown>("reportingUser")?.globalValue),
		// A cloned repo must not charge the user's requests to another quota or fail them against a spent one.
		quotaEntity: quotaEntity(config.inspect<unknown>("quotaEntity")?.globalValue),
		// A fallback can bill a pricier model, so a cloned repo must not pick one for the user.
		fallbackModels: modelIds(config.inspect<unknown>("fallbackModels")?.globalValue),
		// A pinned region can cost more and fails requests it cannot serve, so a cloned repo must not set one.
		inferenceRegion: inferenceRegion(config.inspect<unknown>("inferenceRegion")?.globalValue),
		// An exclusion can move a request to a pricier provider or fail it, so a cloned repo must not set one.
		excludeQuantizations: weightFormats(
			config.inspect<unknown>("excludeQuantizations")?.globalValue,
		),
		// A requirement can move a request to a pricier provider or fail it, so a cloned repo must not set one.
		requiredCapabilities: modelCapabilities(
			config.inspect<unknown>("requiredCapabilities")?.globalValue,
		),
		// The priority tier bills more, so a cloned repo must not pick it for the user.
		serviceTier: serviceTier(config.inspect<unknown>("serviceTier")?.globalValue),
		// Higher effort bills more output tokens, so a cloned repo must not raise it for the user.
		reasoningEffort: reasoningEffort(config.inspect<unknown>("reasoningEffort")?.globalValue),
		// Turning it off can send later turns to a cold prompt cache, so a cloned repo must not do it for the user.
		sessionAffinity: config.inspect<unknown>("sessionAffinity")?.globalValue !== false,
		// A short wait moves requests off the team's own keys onto gateway credits, so a cloned repo must not set one.
		byokProviderTimeouts: byokProviderTimeouts(
			config.inspect<unknown>("byokProviderTimeouts")?.globalValue,
		),
		// Each search bills the user's credits and sends the query to Perplexity, so a cloned repo must not turn it on.
		webSearch: config.inspect<unknown>("webSearch")?.globalValue === true,
	};
}

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

// "provider-default", like any value outside the manifest's enum, leaves the provider's own reasoning.
function reasoningEffort(value: unknown): ReasoningEffort | undefined {
	return REASONING_EFFORTS.find((effort) => effort === value);
}

const PROVIDER_SORTS = ["cost", "ttft", "tps"] as const;

export type ProviderSort = (typeof PROVIDER_SORTS)[number];

// "default", like any value outside the manifest's enum, leaves the gateway's own ranking.
function providerSort(value: unknown): ProviderSort | undefined {
	return PROVIDER_SORTS.find((sort) => sort === value);
}

const SERVICE_TIERS = ["flex", "priority"] as const;

export type ServiceTier = (typeof SERVICE_TIERS)[number];

// "default", like any value outside the manifest's enum, leaves the provider's standard tier.
function serviceTier(value: unknown): ServiceTier | undefined {
	return SERVICE_TIERS.find((tier) => tier === value);
}

const INFERENCE_REGIONS = ["us", "eu", "au", "jp"] as const;

export type InferenceRegion = (typeof INFERENCE_REGIONS)[number];

// "global", like any value outside the manifest's enum, lets the gateway pick the region.
function inferenceRegion(value: unknown): InferenceRegion | undefined {
	return INFERENCE_REGIONS.find((region) => region === value);
}

// settings.json can hold any value; slugs are lowercase, and an empty list leaves the gateway's ranking.
function providerSlugs(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const slugs = value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
	return slugs.length > 0 ? [...new Set(slugs)] : undefined;
}

// The gateway's documented limits for a BYOK provider timeout, in milliseconds.
const MIN_BYOK_TIMEOUT_MS = 1000;
const MAX_BYOK_TIMEOUT_MS = 789000;

function byokProviderTimeouts(value: unknown): Record<string, number> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const timeouts: Record<string, number> = {};
	for (const [key, ms] of Object.entries(value)) {
		const slug = key.trim().toLowerCase();
		if (!slug || typeof ms !== "number" || !Number.isFinite(ms)) continue;
		timeouts[slug] = Math.min(Math.max(Math.round(ms), MIN_BYOK_TIMEOUT_MS), MAX_BYOK_TIMEOUT_MS);
	}
	return Object.keys(timeouts).length > 0 ? timeouts : undefined;
}

// The gateway answers 400 to more than 10 tags or one outside 1 to 64 characters, which would fail every chat request.
const MAX_REPORTING_TAGS = 10;
const MAX_REPORTING_TAG_LENGTH = 64;

function reportingTags(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const tags = value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((tag) => tag.length > 0 && tag.length <= MAX_REPORTING_TAG_LENGTH);
	const unique = [...new Set(tags)].slice(0, MAX_REPORTING_TAGS);
	return unique.length > 0 ? unique : undefined;
}

// The gateway answers 400 to a user longer than this, which would fail every chat request.
const MAX_REPORTING_USER_LENGTH = 256;

function reportingUser(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const user = value.trim();
	return user.length > 0 && user.length <= MAX_REPORTING_USER_LENGTH ? user : undefined;
}

function quotaEntity(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const entity = value.trim();
	return entity.length > 0 ? entity : undefined;
}

// The gateway answers 400 to a format outside this pattern, which would fail every chat request.
const WEIGHT_FORMAT = /^[a-z0-9._-]{1,32}$/;

function weightFormats(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const formats = value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim().toLowerCase())
		.filter((format) => WEIGHT_FORMAT.test(format));
	return formats.length > 0 ? [...new Set(formats)] : undefined;
}

const MODEL_CAPABILITIES = [
	"free",
	"implicit-caching",
	"reasoning",
	"structured-output",
	"tool-use",
	"vision",
] as const;

export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

// The gateway answers 400 to an unknown capability, which would fail every chat request.
function modelCapabilities(value: unknown): ModelCapability[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const capabilities = value.filter((entry): entry is ModelCapability =>
		MODEL_CAPABILITIES.some((capability) => capability === entry),
	);
	return capabilities.length > 0 ? [...new Set(capabilities)] : undefined;
}

function modelIds(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const ids = value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter(Boolean);
	return ids.length > 0 ? [...new Set(ids)] : undefined;
}

// A workspace may turn a filter on but not off, so a cloned repo cannot route the user's prompts past the user's data policy.
function anyScopeEnabled(
	inspected:
		| { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown }
		| undefined,
): boolean {
	return [inspected?.globalValue, inspected?.workspaceValue, inspected?.workspaceFolderValue].some(
		(value) => value === true,
	);
}

// Vercel's docs give base URLs ending in /v1 (OpenAI SDKs) and /v4/ai (AI SDK); the paths here add their own.
const API_VERSION_SUFFIX = /\/v\d+(?:\/ai)?$/i;

// The Settings editor saves a cleared field as "", and settings.json can hold a value of any type.
function normalisedEndpoint(value: unknown): string {
	const trimmed = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
	const endpoint = trimmed.replace(API_VERSION_SUFFIX, "").replace(/\/+$/, "");
	return endpoint || DEFAULT_BASE_URL;
}

// settings.json only warns about a value outside the manifest's type and range, and VS Code returns it anyway.
function boundedTimeout(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
	return Math.min(Math.max(value, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}
