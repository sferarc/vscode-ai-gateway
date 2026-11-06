import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SecretStorage } from "vscode";

const hoisted = vi.hoisted(() => ({
	log: vi.fn(),
	showQuickPick: vi.fn(),
	showInputBox: vi.fn(),
	showInformationMessage: vi.fn(),
}));

vi.mock("vscode", () => ({
	window: {
		showQuickPick: hoisted.showQuickPick,
		showInputBox: hoisted.showInputBox,
		showInformationMessage: hoisted.showInformationMessage,
		createOutputChannel: vi.fn(() => ({
			error: hoisted.log,
			warn: hoisted.log,
			info: hoisted.log,
			debug: hoisted.log,
			show: vi.fn(),
			dispose: vi.fn(),
		})),
	},
}));

import { initializeLogger } from "./logger";
import { manageProviderKeys, ProviderKeyStore } from "./provider-keys";

const SECRET_KEY = "vercelAiGateway.providerKeys";
const CLAUDE = "anthropic/claude-sonnet-4.5";

function createSecrets() {
	const values = new Map<string, string>();
	const secrets = {
		get: vi.fn((key: string) => Promise.resolve(values.get(key))),
		store: vi.fn((key: string, value: string) => {
			values.set(key, value);
			return Promise.resolve();
		}),
		delete: vi.fn((key: string) => {
			values.delete(key);
			return Promise.resolve();
		}),
	};
	return { values, secrets: secrets as unknown as SecretStorage };
}

function loggedText(): string {
	return hoisted.log.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
}

beforeEach(() => {
	vi.clearAllMocks();
	initializeLogger();
});

describe("ProviderKeyStore", () => {
	it("returns no credentials when no key is stored", async () => {
		const store = new ProviderKeyStore(createSecrets().secrets);
		expect(await store.credentials(CLAUDE)).toBeUndefined();
		expect(await store.providers()).toEqual([]);
	});

	it("turns each stored key into one request-scoped credential for its provider", async () => {
		const store = new ProviderKeyStore(createSecrets().secrets);
		await store.set("openai", "sk-openai");
		await store.set("anthropic", "sk-ant");

		expect(await store.providers()).toEqual(["anthropic", "openai"]);
		expect(await store.credentials(CLAUDE)).toEqual({
			anthropic: [{ apiKey: "sk-ant" }],
			openai: [{ apiKey: "sk-openai" }],
		});
	});

	it("sends no keys for a model whose provider has none stored, so the team's dashboard keys still apply", async () => {
		const store = new ProviderKeyStore(createSecrets().secrets);
		await store.set("anthropic", "sk-ant");

		expect(await store.credentials("openai/gpt-5")).toBeUndefined();
		expect(await store.credentials("anthropic")).toEqual({ anthropic: [{ apiKey: "sk-ant" }] });
		expect(await store.credentials("toString/model")).toBeUndefined();
	});

	it("sends every stored key when the model's provider has one, since fallbacks share the request", async () => {
		const store = new ProviderKeyStore(createSecrets().secrets);
		await store.set("anthropic", "sk-ant");
		await store.set("openai", "sk-openai");

		expect(await store.credentials("openai/gpt-5")).toEqual({
			anthropic: [{ apiKey: "sk-ant" }],
			openai: [{ apiKey: "sk-openai" }],
		});
	});

	it("replaces a provider's key and deletes the secret once the last key is removed", async () => {
		const { values, secrets } = createSecrets();
		const store = new ProviderKeyStore(secrets);
		await store.set("anthropic", "old");
		await store.set("anthropic", "new");
		expect(await store.credentials(CLAUDE)).toEqual({ anthropic: [{ apiKey: "new" }] });

		await store.remove("anthropic");
		expect(values.has(SECRET_KEY)).toBe(false);
		expect(await store.credentials(CLAUDE)).toBeUndefined();
	});

	it("ignores an unreadable secret without logging its contents", async () => {
		const { values, secrets } = createSecrets();
		values.set(SECRET_KEY, '{"anthropic": "sk-ant-secret"');
		const store = new ProviderKeyStore(secrets);

		expect(await store.credentials(CLAUDE)).toBeUndefined();
		expect(loggedText()).toContain("unreadable");
		expect(loggedText()).not.toContain("sk-ant-secret");
	});

	it("skips stored entries that are not a slug with a non-empty key", async () => {
		const { values, secrets } = createSecrets();
		values.set(
			SECRET_KEY,
			JSON.stringify({ anthropic: "sk", "Bad Slug": "x", openai: "", xai: 1 }),
		);

		expect(await new ProviderKeyStore(secrets).credentials(CLAUDE)).toEqual({
			anthropic: [{ apiKey: "sk" }],
		});
	});
});

describe("manageProviderKeys", () => {
	it("stores a key entered for a provider and never logs it", async () => {
		const store = new ProviderKeyStore(createSecrets().secrets);
		hoisted.showQuickPick.mockImplementation(async (items: { slug?: string }[]) => items[0]);
		hoisted.showInputBox.mockResolvedValueOnce(" anthropic ").mockResolvedValueOnce(" sk-ant-123 ");

		await manageProviderKeys(store);

		expect(await store.credentials(CLAUDE)).toEqual({ anthropic: [{ apiKey: "sk-ant-123" }] });
		expect(hoisted.showInputBox.mock.calls[1]?.[0]).toMatchObject({ password: true });
		expect(loggedText()).toContain("anthropic");
		expect(loggedText()).not.toContain("sk-ant-123");
	});

	it("accepts a lower case slug and refuses providers that need more than an API key", async () => {
		const store = new ProviderKeyStore(createSecrets().secrets);
		hoisted.showQuickPick.mockImplementation(async (items: { slug?: string }[]) => items[0]);
		hoisted.showInputBox.mockResolvedValueOnce(undefined);
		await manageProviderKeys(store);
		const validate = hoisted.showInputBox.mock.calls[0]?.[0].validateInput as (
			value: string,
		) => string | undefined;

		expect(validate("anthropic")).toBeUndefined();
		expect(validate("Anthropic")).toBeDefined();
		expect(validate("")).toBeDefined();
		for (const slug of ["azure", "bedrock", "vertex"]) {
			expect(validate(slug)).toContain("Vercel dashboard");
		}
	});

	it("removes the key the user picks", async () => {
		const store = new ProviderKeyStore(createSecrets().secrets);
		await store.set("anthropic", "sk-ant");
		await store.set("openai", "sk-openai");
		hoisted.showQuickPick.mockImplementation(async (items: { slug?: string }[]) =>
			items.find((item) => item.slug === "openai"),
		);

		await manageProviderKeys(store);

		expect(await store.providers()).toEqual(["anthropic"]);
		expect(hoisted.showInputBox).not.toHaveBeenCalled();
	});

	it("stores nothing when the key prompt is dismissed", async () => {
		const store = new ProviderKeyStore(createSecrets().secrets);
		hoisted.showQuickPick.mockImplementation(async (items: { slug?: string }[]) => items[0]);
		hoisted.showInputBox.mockResolvedValueOnce("openai").mockResolvedValueOnce(undefined);

		await manageProviderKeys(store);

		expect(await store.credentials(CLAUDE)).toBeUndefined();
	});
});
