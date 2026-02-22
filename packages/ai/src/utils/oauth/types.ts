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
	| "cerebras"
	| "cloudflare-ai-gateway"
	| "cursor"
	| "github-copilot"
	| "google-gemini-cli"
	| "google-antigravity"
	| "gitlab-duo"
	| "huggingface"
	| "kimi-code"
	| "litellm"
	| "minimax-code"
	| "minimax-code-cn"
	| "moonshot"
	| "nvidia"
	| "nanogpt"
	| "ollama"
	| "openai-codex"
	| "opencode"
	| "perplexity"
	| "qianfan"
	| "qwen-portal"
	| "synthetic"
	| "together"
	| "venice"
	| "vllm"
	| "xiaomi"
	| "zai";

export type OAuthProviderId = OAuthProvider | (string & {});

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
	id: OAuthProviderId;
	name: string;
	available: boolean;
}

export interface OAuthController {
	onAuth?(info: OAuthAuthInfo): void;
	onProgress?(message: string): void;
	onManualCodeInput?(): Promise<string>;
	onPrompt?(prompt: OAuthPrompt): Promise<string>;
	signal?: AbortSignal;
}

export interface OAuthLoginCallbacks extends OAuthController {
	onAuth: (info: OAuthAuthInfo) => void;
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
}

export interface OAuthProviderInterface {
	readonly id: OAuthProviderId;
	readonly name: string;
	readonly sourceId?: string;
	login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials | string>;
	refreshToken?(credentials: OAuthCredentials): Promise<OAuthCredentials>;
	getApiKey?(credentials: OAuthCredentials): string;
}
