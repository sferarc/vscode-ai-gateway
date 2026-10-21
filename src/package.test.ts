import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles, PackageManager } from "@vscode/vsce";
import { describe, expect, it } from "vitest";
import { EXTENSION_ID } from "./constants";

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

interface Manifest {
	engines: { vscode: string };
	devDependencies: Record<string, string>;
	activationEvents: string[];
	contributes: {
		commands: { command: string }[];
		languageModelChatProviders: { vendor: string }[];
		authentication: { id: string }[];
	};
}

async function readManifest(): Promise<Manifest> {
	return JSON.parse(await readFile(join(root, "package.json"), "utf8"));
}

describe("manifest", () => {
	it("pins @types/vscode to the engines.vscode floor", async () => {
		const pkg = await readManifest();

		expect(pkg.devDependencies["@types/vscode"]).toBe(pkg.engines.vscode.replace(/^\^/, ""));
	});

	it("contributes exactly the commands that activate() registers", async () => {
		const pkg = await readManifest();
		const source = await readFile(join(root, "src/extension.ts"), "utf8");
		const registered = [...source.matchAll(/registerCommand\(\s*`\$\{EXTENSION_ID\}\.(\w+)`/g)].map(
			(match) => `${EXTENSION_ID}.${match[1]}`,
		);

		expect(source.match(/registerCommand\(/g)).toHaveLength(registered.length);
		expect(registered.length).toBeGreaterThan(0);
		expect(pkg.contributes.commands.map((c) => c.command).sort()).toEqual(registered.sort());
	});

	it("declares the chat provider and authentication provider under the registered id", async () => {
		const pkg = await readManifest();
		const extension = await readFile(join(root, "src/extension.ts"), "utf8");
		const auth = await readFile(join(root, "src/auth.ts"), "utf8");

		expect(extension).toMatch(/registerLanguageModelChatProvider\(\s*EXTENSION_ID\b/);
		expect(auth).toMatch(/registerAuthenticationProvider\(\s*EXTENSION_ID\b/);
		expect(pkg.contributes.languageModelChatProviders.map((p) => p.vendor)).toEqual([EXTENSION_ID]);
		expect(pkg.contributes.authentication.map((a) => a.id)).toEqual([EXTENSION_ID]);
	});

	it("activates only on the contributed chat provider", async () => {
		const pkg = await readManifest();

		expect(pkg.activationEvents).toEqual([`onLanguageModelChatProvider:${EXTENSION_ID}`]);
	});
});
