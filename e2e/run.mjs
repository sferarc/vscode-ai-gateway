import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";
import manifest from "../package.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The engines floor, so the test runs the oldest VS Code the manifest claims to support.
const version = manifest.engines.vscode.replace(/^\^/, "");

try {
	await runTests({
		version,
		extensionDevelopmentPath: root,
		extensionTestsPath: path.join(root, "e2e", "suite.cjs"),
		// A throwaway profile keeps the run off the developer's own settings and extensions.
		launchArgs: [
			"--disable-extensions",
			"--user-data-dir",
			mkdtempSync(path.join(tmpdir(), "vscode-ai-gateway-e2e-")),
		],
	});
} catch (error) {
	console.error(error);
	process.exit(1);
}
