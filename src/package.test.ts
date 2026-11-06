import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles, PackageManager } from "@vscode/vsce";
import { describe, expect, it } from "vitest";
import { EXTENSION_ID, SIGNED_IN_CONTEXT_KEY, STATUS_TOOL_NAME } from "./constants";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("VSIX contents", () => {
	it("leaves the contributor notes out of the package", async () => {
		const files = await listFiles({ cwd: root, packageManager: PackageManager.None });

		expect(files).toContain("package.json");
		expect(files).toContain("README.md");
		expect(files).not.toContain("AGENTS.md");
		expect(files).not.toContain("CLAUDE.md");
		expect(files.filter((file) => file.startsWith("brain/"))).toEqual([]);
	});

	it("packages the walkthrough media", async () => {
		const files = await listFiles({ cwd: root, packageManager: PackageManager.None });
		const pkg = await readManifest();
		const media = pkg.contributes.walkthroughs.flatMap((w) => w.steps.map((s) => s.media.markdown));

		expect(media.length).toBeGreaterThan(0);
		for (const path of media) {
			expect(files).toContain(path);
		}
	});
});

interface Manifest {
	engines: { vscode: string };
	keywords: string[];
	pricing?: string;
	qna?: string | false;
	bugs: { url: string };
	devDependencies: Record<string, string>;
	activationEvents: string[];
	capabilities: {
		untrustedWorkspaces: {
			supported: boolean | "limited";
			description?: string;
			restrictedConfigurations?: string[];
		};
	};
	contributes: {
		commands: { command: string }[];
		languageModelTools: {
			name: string;
			canBeReferencedInPrompt?: boolean;
			inputSchema: { properties: { modelIds: { maxItems: number } } };
		}[];
		languageModelChatProviders: { vendor: string; icon?: unknown }[];
		authentication: { id: string }[];
		walkthroughs: {
			steps: {
				id: string;
				description: string;
				media: { markdown: string };
				completionEvents: string[];
			}[];
		}[];
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

	it("contributes the status tool that activate() registers, referenceable in prompts", async () => {
		const pkg = await readManifest();
		const extension = await readFile(join(root, "src/extension.ts"), "utf8");
		const tools = await readFile(join(root, "src/tools.ts"), "utf8");

		expect(extension.match(/registerTool\(/g)).toHaveLength(1);
		expect(extension).toMatch(/registerTool\(\s*STATUS_TOOL_NAME\b/);
		expect(pkg.contributes.languageModelTools.map((t) => t.name)).toEqual([STATUS_TOOL_NAME]);
		expect(pkg.contributes.languageModelTools[0]?.canBeReferencedInPrompt).toBe(true);
		const maxItems =
			pkg.contributes.languageModelTools[0]?.inputSchema.properties.modelIds.maxItems;
		expect(tools).toContain(`const MAX_MODEL_IDS = ${maxItems};`);
	});

	it("gives the chat provider a theme icon for the model picker", async () => {
		const pkg = await readManifest();

		// A $(name) reference needs no asset and follows the theme; VS Code before 1.143 ignores it.
		expect(pkg.contributes.languageModelChatProviders[0]?.icon).toMatch(/^\$\([a-z0-9-]+\)$/);
	});

	it("walks through getting a key, signing in and opening chat", async () => {
		const pkg = await readManifest();
		const steps = pkg.contributes.walkthroughs[0]?.steps ?? [];
		const commands = pkg.contributes.commands.map((c) => c.command);

		expect(steps.map((s) => s.id)).toEqual(["getKey", "signIn", "openChat"]);
		expect(steps[1]?.completionEvents).toEqual([`onContext:${SIGNED_IN_CONTEXT_KEY}`]);
		expect(steps[0]?.completionEvents).toContain(`onContext:${SIGNED_IN_CONTEXT_KEY}`);
		for (const step of steps) {
			for (const [, command] of step.description.matchAll(/\(command:([\w.]+)\)/g)) {
				if (command?.startsWith(`${EXTENSION_ID}.`)) {
					expect(commands).toContain(command);
				}
			}
		}
		expect(steps[1]?.description).toContain(`(command:${EXTENSION_ID}.manage)`);
	});

	it("activates only on the contributed chat provider", async () => {
		const pkg = await readManifest();

		expect(pkg.activationEvents).toEqual([`onLanguageModelChatProvider:${EXTENSION_ID}`]);
	});

	it("stays enabled in Restricted Mode and restricts every setting a workspace can set", async () => {
		const pkg = await readManifest();
		const config = await readFile(join(root, "src/config.ts"), "utf8");
		// Settings read through inspect(...).globalValue already ignore workspace values.
		const workspaceReadable = [...config.matchAll(/config\.get(?:<[^>]*>)?\(\s*"(\w+)"/g)].map(
			(match) => `${EXTENSION_ID}.${match[1]}`,
		);
		const trust = pkg.capabilities.untrustedWorkspaces;

		expect(workspaceReadable.length).toBeGreaterThan(0);
		expect(trust.supported).toBe("limited");
		expect(trust.description).toBeTruthy();
		expect([...(trust.restrictedConfigurations ?? [])].sort()).toEqual(workspaceReadable.sort());
	});

	it("sends Marketplace questions to the issue tracker and keeps at most 30 unique keywords", async () => {
		const pkg = await readManifest();

		expect(pkg.pricing).toBe("Free");
		expect(pkg.qna).toBe(pkg.bugs.url);
		expect(pkg.keywords.length).toBeLessThanOrEqual(30);
		expect(new Set(pkg.keywords).size).toBe(pkg.keywords.length);
	});
});
