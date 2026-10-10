/**
 * First-run guidance for the interactive TUI.
 *
 * Two onboarding failures are decided here, both read-only:
 * - No usable model: open sign-in immediately instead of waiting for a failed prompt, and name
 *   any Codex CLI or Claude Code login already on this machine that `omk provider adopt` can reuse.
 * - A model chosen only because ambient cloud credentials exist (AWS_PROFILE, AWS keys, Google
 *   ADC): say which variables caused it, so a stray S3 key does not surface later as a cryptic
 *   Bedrock authentication error on the first prompt.
 *
 * Foreign credential stores are only checked for existence; their contents are never read here.
 */
import { existsSync } from "node:fs";
import {
	credentialSourcePath,
	EXTERNAL_CREDENTIAL_SOURCE_LABELS,
	PROVIDER_CREDENTIAL_SOURCES,
} from "../../core/external-credential-sources.ts";
import { AMBIENT_CREDENTIAL_PROVIDERS, type CredentialSource } from "../../core/provider-default-models.ts";

export interface FirstRunPlan {
	readonly openLogin: boolean;
	readonly notices: readonly string[];
}

export interface FirstRunInput {
	readonly session: {
		readonly model: { readonly provider: string; readonly id: string } | undefined;
		readonly modelRegistry: {
			readonly authStorage: { getAuthStatus(provider: string): { readonly source?: CredentialSource } };
		};
	};
	readonly settings: { getDefaultProvider(): string | undefined };
	readonly initialMessage: string | undefined;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly exists?: (path: string) => boolean;
}

const AMBIENT_ENV_VARS: Readonly<Record<string, readonly string[]>> = {
	"amazon-bedrock": [
		"AWS_PROFILE",
		"AWS_ACCESS_KEY_ID",
		"AWS_BEARER_TOKEN_BEDROCK",
		"AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
		"AWS_CONTAINER_CREDENTIALS_FULL_URI",
		"AWS_WEB_IDENTITY_TOKEN_FILE",
	],
	"google-vertex": ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"],
};

function adoptableLogins(env: Readonly<Record<string, string | undefined>>, exists: (path: string) => boolean) {
	const found: string[] = [];
	for (const [provider, sources] of Object.entries(PROVIDER_CREDENTIAL_SOURCES)) {
		for (const source of sources) {
			if (!exists(credentialSourcePath(source, { env }))) continue;
			found.push(
				`Found an existing ${EXTERNAL_CREDENTIAL_SOURCE_LABELS[source]} login. To reuse it instead of signing in again, exit and run: omk provider adopt ${provider}`,
			);
		}
	}
	return found;
}

export function planFirstRun(input: FirstRunInput): FirstRunPlan {
	const env = input.env ?? process.env;
	const exists = input.exists ?? existsSync;
	// The session carries an { provider: "unknown", id: "unknown" } sentinel when nothing is usable.
	const current = input.session.model;
	const model = current && !(current.provider === "unknown" && current.id === "unknown") ? current : undefined;
	if (!model) {
		if (input.initialMessage !== undefined) return { openLogin: false, notices: [] };
		return {
			openLogin: true,
			notices: [
				"First run: no model is configured yet, so sign-in is open below. Esc skips it; /login reopens it; `omk doctor` lists what OMK found on this machine.",
				...adoptableLogins(env, exists),
			],
		};
	}
	if (!AMBIENT_CREDENTIAL_PROVIDERS.has(model.provider)) return { openLogin: false, notices: [] };
	if (input.settings.getDefaultProvider() === model.provider) return { openLogin: false, notices: [] };
	const source = input.session.modelRegistry.authStorage.getAuthStatus(model.provider).source;
	if (source === "stored" || source === "runtime") return { openLogin: false, notices: [] };
	const present = (AMBIENT_ENV_VARS[model.provider] ?? []).filter((name) => Boolean(env[name]));
	const cause = present.length > 0 ? present.join(", ") : "ambient cloud credentials";
	return {
		openLogin: false,
		notices: [
			`Using ${model.provider}/${model.id} because ${cause} is set in this environment. If those credentials are not meant for ${model.provider}, pick another provider with /login or /model.`,
		],
	};
}
