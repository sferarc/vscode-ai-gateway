import { type SecretStorage, window } from "vscode";
import { EXTENSION_ID } from "./constants";
import { logger } from "./logger";

const PROVIDER_KEYS_SECRET_KEY = `${EXTENSION_ID}.providerKeys`;

const PROVIDER_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Providers whose request-scoped credential needs more than an API key (Vercel's BYOK docs). */
const MULTI_FIELD_PROVIDERS = new Set(["azure", "bedrock", "vertex"]);

export type ByokCredentials = Record<string, [{ apiKey: string }]>;

function validateProviderSlug(value: string): string | undefined {
	const slug = value.trim();
	if (!PROVIDER_SLUG_PATTERN.test(slug)) {
		return "Enter a provider slug in lower case, such as anthropic or openai.";
	}
	if (MULTI_FIELD_PROVIDERS.has(slug)) {
		return `${slug} credentials need more than an API key; add them in the Vercel dashboard instead.`;
	}
	return undefined;
}

/** Provider API keys sent to the gateway as request-scoped BYOK credentials, kept only in SecretStorage. */
export class ProviderKeyStore {
	constructor(private readonly secrets: SecretStorage) {}

	async providers(): Promise<string[]> {
		return Object.keys(await this.read()).sort();
	}

	async credentials(): Promise<ByokCredentials | undefined> {
		const keys = await this.read();
		const slugs = Object.keys(keys);
		if (slugs.length === 0) return undefined;
		return Object.fromEntries(
			slugs.map((slug) => [slug, [{ apiKey: keys[slug] as string }]]),
		) as ByokCredentials;
	}

	async set(slug: string, apiKey: string): Promise<void> {
		const keys = await this.read();
		keys[slug] = apiKey;
		await this.secrets.store(PROVIDER_KEYS_SECRET_KEY, JSON.stringify(keys));
	}

	async remove(slug: string): Promise<void> {
		const keys = await this.read();
		delete keys[slug];
		if (Object.keys(keys).length === 0) {
			await this.secrets.delete(PROVIDER_KEYS_SECRET_KEY);
		} else {
			await this.secrets.store(PROVIDER_KEYS_SECRET_KEY, JSON.stringify(keys));
		}
	}

	private async read(): Promise<Record<string, string>> {
		const stored = await this.secrets.get(PROVIDER_KEYS_SECRET_KEY);
		if (!stored) return {};
		let parsed: unknown;
		try {
			parsed = JSON.parse(stored);
		} catch {
			// The parse error would quote the stored text, which holds keys.
			logger.warn("Stored provider keys are unreadable; ignoring them");
			return {};
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		const keys: Record<string, string> = {};
		for (const [slug, apiKey] of Object.entries(parsed)) {
			if (PROVIDER_SLUG_PATTERN.test(slug) && typeof apiKey === "string" && apiKey) {
				keys[slug] = apiKey;
			}
		}
		return keys;
	}
}

const ADD_ITEM = "$(add) Add a provider key";

export async function manageProviderKeys(store: ProviderKeyStore): Promise<void> {
	const providers = await store.providers();
	const choice = await window.showQuickPick(
		[
			{ label: ADD_ITEM, slug: undefined },
			...providers.map((slug) => ({
				label: `$(trash) Remove the ${slug} key`,
				slug,
			})),
		],
		{ placeHolder: "Provider API keys sent to the gateway as your own (BYOK) credentials" },
	);
	if (!choice) return;

	if (choice.slug) {
		await store.remove(choice.slug);
		logger.info(`Removed the ${choice.slug} provider key`);
		window.showInformationMessage(`Removed the ${choice.slug} provider key.`);
		return;
	}

	const slug = (
		await window.showInputBox({
			prompt: "Provider slug, as in the gateway's model ids",
			placeHolder: "anthropic",
			ignoreFocusOut: true,
			validateInput: validateProviderSlug,
		})
	)?.trim();
	if (!slug) return;

	const apiKey = (
		await window.showInputBox({
			prompt: `API key for ${slug}`,
			password: true,
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim() ? undefined : "Enter the provider's API key."),
		})
	)?.trim();
	if (!apiKey) return;

	await store.set(slug, apiKey);
	logger.info(`Stored a ${slug} provider key`);
	window.showInformationMessage(
		`Chat requests now send your ${slug} key to the gateway, which uses it instead of the team's ${slug} keys.`,
	);
}
