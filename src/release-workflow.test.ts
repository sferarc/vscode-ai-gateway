import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflow = fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url));

describe("release workflow", () => {
	it("reads the changesets action's kebab-case has-changesets output", async () => {
		const source = await readFile(workflow, "utf8");

		expect(source).toContain("steps.changesets.outputs.has-changesets == 'false'");
		expect(source).not.toContain("outputs.hasChangesets");
	});
});
