const assert = require("node:assert/strict");
const vscode = require("vscode");

const manifest = require("../package.json");

const EXTENSION_ID = `${manifest.publisher}.${manifest.name}`;
const VENDOR = manifest.contributes.languageModelChatProviders[0].vendor;
const COMMANDS = manifest.contributes.commands.map(({ command }) => command);
const TOOLS = manifest.contributes.languageModelTools.map(({ name }) => name);

async function run() {
	const extension = vscode.extensions.getExtension(EXTENSION_ID);
	assert.ok(extension, `${EXTENSION_ID} is not installed in the extension host`);
	assert.equal(extension.isActive, false, "the extension must wait for its activation event");

	// VS Code rejects a provider for an uncontributed vendor, so activation implies registration.
	await vscode.lm.selectChatModels({ vendor: VENDOR });
	assert.equal(extension.isActive, true, "the chat provider activation event did not activate it");
	await vscode.commands.executeCommand("vercelAiGateway.showLogs");

	const registered = await vscode.commands.getCommands(true);
	for (const command of COMMANDS) {
		assert.ok(registered.includes(command), `command ${command} is not registered`);
	}

	const tools = vscode.lm.tools.map(({ name }) => name);
	for (const tool of TOOLS) {
		assert.ok(tools.includes(tool), `language model tool ${tool} is not registered`);
	}

	const { contributes, capabilities } = extension.packageJSON;
	const unresolved = placeholders({ contributes, capabilities });
	assert.deepEqual(unresolved, [], "VS Code left package.nls.json placeholders unresolved");
}

function placeholders(value) {
	if (typeof value === "string") return /^%[^%]+%$/.test(value) ? [value] : [];
	if (value && typeof value === "object") return Object.values(value).flatMap(placeholders);
	return [];
}

module.exports = { run };
