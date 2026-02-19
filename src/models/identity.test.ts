import { describe, expect, it } from "vitest";
import { parseModelIdentity } from "./identity";

describe("parseModelIdentity", () => {
	it.each([
		// Standard colon format with date versions
		["openai:gpt-4o-2024-11-20", "openai", "gpt-4o", "2024-11-20"],
		["anthropic:claude-3-opus-20240229", "anthropic", "claude-3-opus", "20240229"],
		["anthropic:claude-3-5-sonnet-20241022", "anthropic", "claude-3-5-sonnet", "20241022"],
		// Semantic versions (X.Y.Z only — X.Y is treated as model series)
		["mistral:mistral-large-0.1.0", "mistral", "mistral-large", "0.1.0"],
		// Model series numbers (X.Y) should NOT be parsed as versions
		["google:gemini-1.5", "google", "gemini-1.5", "latest"],
		["google:gemini-2.0-flash", "google", "gemini-2.0-flash", "latest"],
		// No version (returns "latest")
		["openai:gpt-4o-mini", "openai", "gpt-4o-mini", "latest"],
		["openai:o3-mini", "openai", "o3-mini", "latest"],
		// Slash format (gateway style)
		["openai/gpt-4o", "openai", "gpt-4o", "latest"],
		// No provider
		["gpt-4o", "", "gpt-4o", "latest"],
	])("parses %s", (modelId, provider, family, version) => {
		const result = parseModelIdentity(modelId);
		expect(result.provider).toBe(provider);
		expect(result.family).toBe(family);
		expect(result.version).toBe(version);
		expect(result.fullId).toBe(modelId);
	});

	it("handles empty string", () => {
		const result = parseModelIdentity("");
		expect(result).toEqual({ provider: "", family: "", version: "latest", fullId: "" });
	});
});
