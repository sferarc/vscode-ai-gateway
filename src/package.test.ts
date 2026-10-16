import { fileURLToPath } from "node:url";
import { listFiles, PackageManager } from "@vscode/vsce";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("VSIX contents", () => {
	it("leaves the contributor notes out of the package", async () => {
		const files = await listFiles({ cwd: root, packageManager: PackageManager.None });

		expect(files).toContain("package.json");
		expect(files).toContain("README.md");
		expect(files).not.toContain("CLAUDE.md");
		expect(files.filter((file) => file.startsWith("brain/"))).toEqual([]);
	});
});
