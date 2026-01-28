export type OAuthCredentials = {
	refresh: string;
	access: string;
	expires: number;
	enterpriseUrl?: string;
	projectId?: string;
	email?: string;
	accountId?: string;
};

export type OAuthProvider =
	| "anthropic"
	| "github-copilot"
	| "google-gemini-cli"
	| "google-antigravity"
	| "kimi-code"
	| "openai-codex"
	| "cursor";

export type OAuthPrompt = {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
};

export type OAuthAuthInfo = {
	url: string;
	instructions?: string;
};

export interface OAuthProviderInfo {
	id: OAuthProvider;
	name: string;
	available: boolean;
}

export interface OAuthController {
	onAuth?(info: { url: string; instructions?: string }): void;
	onProgress?(message: string): void;
	onManualCodeInput?(): Promise<string>;
	onPrompt?(prompt: OAuthPrompt): Promise<string>;
	signal?: AbortSignal;
}
