/**
 * Model identity parsing utilities for extracting provider, family, and version
 * from model IDs in the format "provider:family-version"
 */

export interface ParsedModelIdentity {
	provider: string; // "openai"
	family: string; // "gpt-4o"
	version: string; // "2024-11-20" or "latest"
	fullId: string; // "openai:gpt-4o-2024-11-20"
}

/**
 * Version pattern regex that matches:
 * - Date: YYYY-MM-DD (e.g., 2024-11-20)
 * - Compact date: YYYYMMDD (e.g., 20241022)
 * - Short date: YYYYMM (e.g., 202411)
 * - Year only: YYYY (e.g., 2024)
 * - Semantic: X.Y.Z (e.g., 0.1.0) — X.Y alone is excluded as it's ambiguous
 *   with model series names (e.g., gemini-1.5, gemini-2.0)
 */
const VERSION_PATTERN = /[-_](\d{4}-\d{2}-\d{2}|\d{4,8}|\d+\.\d+\.\d+)$/;

/**
 * Parses a model ID into its constituent parts.
 *
 * @param modelId - The full model ID (e.g., "openai:gpt-4o-2024-11-20")
 * @returns ParsedModelIdentity with provider, family, version, and fullId
 *
 * @example
 * parseModelIdentity("openai:gpt-4o-2024-11-20")
 * // => { provider: "openai", family: "gpt-4o", version: "2024-11-20", fullId: "openai:gpt-4o-2024-11-20" }
 *
 * @example
 * parseModelIdentity("google:gemini-2.0-flash")
 * // => { provider: "google", family: "gemini-2.0-flash", version: "latest", fullId: "google:gemini-2.0-flash" }
 */
export function parseModelIdentity(modelId: string): ParsedModelIdentity {
	const colonIndex = modelId.indexOf(":");
	const slashIndex = modelId.indexOf("/");

	let provider: string;
	let modelPart: string;

	if (colonIndex !== -1) {
		// Colon format: "provider:model"
		provider = modelId.slice(0, colonIndex);
		modelPart = modelId.slice(colonIndex + 1);
	} else if (slashIndex !== -1) {
		// Slash format: "provider/model" (gateway format)
		provider = modelId.slice(0, slashIndex);
		modelPart = modelId.slice(slashIndex + 1);
	} else {
		// No separator found, no provider
		provider = "";
		modelPart = modelId;
	}

	const { family, version } = extractFamilyAndVersion(modelPart);

	return {
		provider,
		family,
		version,
		fullId: modelId,
	};
}

/**
 * Extracts family and version from the model part (after the provider colon).
 */
function extractFamilyAndVersion(modelPart: string): {
	family: string;
	version: string;
} {
	if (!modelPart) {
		return { family: "", version: "latest" };
	}

	const match = modelPart.match(VERSION_PATTERN);

	if (match) {
		// Found a version pattern at the end
		const version = match[1];
		// Family is everything before the version suffix (including the separator)
		const family = modelPart.slice(0, match.index);
		return { family, version };
	}

	// No version pattern found
	return { family: modelPart, version: "latest" };
}
