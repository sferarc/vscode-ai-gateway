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
	};
}

const PROVIDER_SORTS = ["cost", "ttft", "tps"] as const;

export type ProviderSort = (typeof PROVIDER_SORTS)[number];

// "default", like any value outside the manifest's enum, leaves the gateway's own ranking.
function providerSort(value: unknown): ProviderSort | undefined {
	return PROVIDER_SORTS.find((sort) => sort === value);
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
