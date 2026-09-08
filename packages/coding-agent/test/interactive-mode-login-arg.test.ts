import { describe, expect, it, vi } from "vitest";
import { InteractiveMode, resolveLoginProviderArg } from "../src/modes/interactive/interactive-mode.ts";

type AuthType = "oauth" | "api_key";

type SubmitContext = {
	defaultEditor: { onSubmit?: (text: string) => void };
	editor: {
		addToHistory?: (text: string) => void;
		setText: (text: string) => void;
	};
	session: {
		isCompacting: boolean;
		isStreaming: boolean;
		isBashRunning: boolean;
		resourceLoader: {
			getSkills: () => { skills: Array<{ name: string }> };
		};
		prompt: (text: string, options?: unknown) => Promise<void>;
		modelRegistry: {
			authStorage: {
				getOAuthProviders: () => Array<{ id: string; name: string }>;
				listOAuthAccounts: () => Array<unknown>;
				list: () => string[];
				get: (providerId: string) => { type: AuthType } | undefined;
				logout: (providerId: string) => void;
				getOAuthAccountCount: (providerId: string) => number;
			};
			getProviderDisplayName: (providerId: string) => string;
			getAll: () => Array<{ provider: string }>;
			refresh: () => void;
		};
	};
	flushPendingBashComponents: () => void;
	handleAttachCommand: (text: string) => void;
	handleBashCommand: (command: string, excludeFromContext?: boolean) => Promise<void>;
	handleClearCommand: () => Promise<void>;
	showWarning: (message: string) => void;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
	updateEditorBorderColor: () => void;
	updateAvailableProviderCount: () => Promise<void>;
	isBashMode: boolean;
	onInputCallback?: (payload: { text: string }) => void;
	pendingPromptPayloads: Array<{ text: string }>;
	// login-path seams (spied in tests)
	showOAuthSelector: (mode: "login" | "logout") => Promise<void>;
	showLoginDialog: (providerId: string, providerName: string) => Promise<void>;
	showApiKeyLoginDialog: (providerId: string, providerName: string) => Promise<void>;
	showOAuthAccountSelector: (provider: { id: string; name: string; authType: string }) => void;
	showBedrockSetupDialog: (providerId: string, providerName: string) => void;
	handleLoginProviderArg: (arg: string) => Promise<void>;
	handleLogoutProviderArg: (arg: string) => Promise<void>;
	getLoginProviderOptions: (authType?: AuthType) => Array<{ id: string; name: string; authType: AuthType }>;
	getLogoutProviderOptions: () => Array<{ id: string; name: string; authType: AuthType }>;
	startLoginForProvider: (provider: { id: string; name: string; authType: AuthType }) => Promise<void>;
	logoutProvider: (provider: { id: string; name: string; authType: AuthType }) => Promise<void>;
};

type InteractiveModePrivate = {
	setupEditorSubmitHandler(this: SubmitContext): void;
	handleLoginProviderArg(this: SubmitContext, arg: string): Promise<void>;
	handleLogoutProviderArg(this: SubmitContext, arg: string): Promise<void>;
	getLoginProviderOptions(
		this: SubmitContext,
		authType?: AuthType,
	): Array<{ id: string; name: string; authType: AuthType }>;
	getLogoutProviderOptions(this: SubmitContext): Array<{ id: string; name: string; authType: AuthType }>;
	startLoginForProvider(
		this: SubmitContext,
		provider: { id: string; name: string; authType: AuthType },
	): Promise<void>;
	logoutProvider(this: SubmitContext, provider: { id: string; name: string; authType: AuthType }): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrivate;

function createSubmitContext(): SubmitContext {
	const context: SubmitContext = {
		defaultEditor: {},
		editor: {
			addToHistory: vi.fn(),
			setText: vi.fn(),
		},
		session: {
			isCompacting: false,
			isStreaming: false,
			isBashRunning: false,
			resourceLoader: {
				getSkills: () => ({ skills: [] }),
			},
			prompt: vi.fn(async () => {}),
			modelRegistry: {
				authStorage: {
					getOAuthProviders: () => [{ id: "meta", name: "Muse Code (subscription)" }],
					listOAuthAccounts: () => [],
					list: () => [],
					get: () => undefined,
					logout: vi.fn(),
					getOAuthAccountCount: () => 0,
				},
				getProviderDisplayName: (providerId: string) => providerId,
				getAll: () => [{ provider: "meta" }],
				refresh: vi.fn(),
			},
		},
		flushPendingBashComponents: vi.fn(),
		handleAttachCommand: vi.fn(),
		handleBashCommand: vi.fn(async () => {}),
		handleClearCommand: vi.fn(async () => {}),
		showWarning: vi.fn(),
		showStatus: vi.fn(),
		showError: vi.fn(),
		updateEditorBorderColor: vi.fn(),
		updateAvailableProviderCount: vi.fn(async () => {}),
		isBashMode: false,
		pendingPromptPayloads: [],
		showOAuthSelector: vi.fn(async () => {}),
		showLoginDialog: vi.fn(async () => {}),
		showApiKeyLoginDialog: vi.fn(async () => {}),
		showOAuthAccountSelector: vi.fn(),
		showBedrockSetupDialog: vi.fn(),
		handleLoginProviderArg: async () => {},
		handleLogoutProviderArg: async () => {},
		getLoginProviderOptions: () => [],
		getLogoutProviderOptions: () => [],
		startLoginForProvider: async () => {},
		logoutProvider: async () => {},
	};
	context.handleLoginProviderArg = (arg: string) => interactiveModePrototype.handleLoginProviderArg.call(context, arg);
	context.handleLogoutProviderArg = (arg: string) =>
		interactiveModePrototype.handleLogoutProviderArg.call(context, arg);
	context.getLoginProviderOptions = (authType?: AuthType) =>
		interactiveModePrototype.getLoginProviderOptions.call(context, authType);
	context.getLogoutProviderOptions = () => interactiveModePrototype.getLogoutProviderOptions.call(context);
	context.startLoginForProvider = (provider: { id: string; name: string; authType: AuthType }) =>
		interactiveModePrototype.startLoginForProvider.call(context, provider);
	context.logoutProvider = (provider: { id: string; name: string; authType: AuthType }) =>
		interactiveModePrototype.logoutProvider.call(context, provider);
	return context;
}

describe("InteractiveMode /login with provider argument", () => {
	it("does NOT send '/login meta' to the LLM as a normal message", async () => {
		const context = createSubmitContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("/login meta");

		// Bug behavior: falls through to the normal-message path (LLM receives it)
		expect(context.pendingPromptPayloads).toEqual([]);
	});

	it("routes '/login meta' directly to the meta login flow", async () => {
		const context = createSubmitContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("/login meta");

		expect(context.showLoginDialog).toHaveBeenCalledWith("meta", expect.stringContaining("Muse"));
		expect(context.editor.setText).toHaveBeenCalledWith("");
	});

	it("keeps bare '/login' opening the provider selector", async () => {
		const context = createSubmitContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("/login");

		expect(context.showOAuthSelector).toHaveBeenCalledWith("login");
		expect(context.showLoginDialog).not.toHaveBeenCalled();
	});

	it("warns on an unknown '/login <provider>' instead of sending it to the LLM", async () => {
		const context = createSubmitContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("/login nope-not-a-provider");

		expect(context.pendingPromptPayloads).toEqual([]);
		expect(context.showWarning).toHaveBeenCalledWith(expect.stringContaining("nope-not-a-provider"));
	});
});

describe("InteractiveMode /logout with provider argument", () => {
	function createLoggedInContext(): SubmitContext {
		const context = createSubmitContext();
		context.session.modelRegistry.authStorage = {
			getOAuthProviders: () => [{ id: "meta", name: "Muse Code (subscription)" }],
			listOAuthAccounts: () => [],
			list: () => ["meta"],
			get: () => ({ type: "oauth" as const }),
			logout: vi.fn(),
			getOAuthAccountCount: () => 1,
		};
		context.session.modelRegistry.getProviderDisplayName = (providerId: string) =>
			providerId === "meta" ? "Muse Code (subscription)" : providerId;
		return context;
	}

	it("does NOT send '/logout meta' to the LLM as a normal message", async () => {
		const context = createLoggedInContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("/logout meta");

		expect(context.pendingPromptPayloads).toEqual([]);
	});

	it("logs out of meta directly without opening the selector", async () => {
		const context = createLoggedInContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("/logout meta");

		expect(context.session.modelRegistry.authStorage.logout).toHaveBeenCalledWith("meta");
		expect(context.showStatus).toHaveBeenCalledWith(expect.stringContaining("Muse Code"));
		expect(context.showOAuthSelector).not.toHaveBeenCalled();
		expect(context.editor.setText).toHaveBeenCalledWith("");
	});

	it("keeps bare '/logout' opening the provider selector", async () => {
		const context = createLoggedInContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("/logout");

		expect(context.showOAuthSelector).toHaveBeenCalledWith("logout");
		expect(context.session.modelRegistry.authStorage.logout).not.toHaveBeenCalled();
	});

	it("warns on '/logout <provider>' with no stored credential instead of sending it to the LLM", async () => {
		const context = createLoggedInContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("/logout nope-not-a-provider");

		expect(context.pendingPromptPayloads).toEqual([]);
		expect(context.showWarning).toHaveBeenCalledWith(expect.stringContaining("nope-not-a-provider"));
		expect(context.session.modelRegistry.authStorage.logout).not.toHaveBeenCalled();
	});
});

describe("login autocomplete", () => {
	// Exercises the same option source + dedupe the login autocomplete uses.
	it("offers provider ids without oauth/api_key duplicates", () => {
		const context = createSubmitContext();
		const options = [
			{ id: "meta", name: "Muse Code (subscription)", authType: "oauth" as const },
			{ id: "meta", name: "Meta Model API", authType: "api_key" as const },
			{ id: "openai-codex", name: "ChatGPT (subscription)", authType: "oauth" as const },
		];
		void context;
		const seen = new Set<string>();
		const unique = options.filter((option) => {
			if (seen.has(option.id)) return false;
			seen.add(option.id);
			return true;
		});
		expect(unique.map((option) => option.id)).toEqual(["meta", "openai-codex"]);
		expect(resolveLoginProviderArg("meta", options)?.authType).toBe("oauth");
	});
});

describe("meta api-key entry naming", () => {
	it("labels the meta API-key option distinctly from the subscription entry", () => {
		const context = createSubmitContext();
		// Mirrors the real ModelRegistry.getProviderDisplayName precedence:
		// the oauth name wins for the shared "meta" id.
		context.session.modelRegistry.getProviderDisplayName = () => "Muse Code (subscription)";
		const options = interactiveModePrototype.getLoginProviderOptions.call(context);
		const apiKeyEntry = options.find((option) => option.id === "meta" && option.authType === "api_key");
		const oauthEntry = options.find((option) => option.id === "meta" && option.authType === "oauth");
		expect(oauthEntry?.name).toBe("Muse Code (subscription)");
		expect(apiKeyEntry?.name).not.toBe("Muse Code (subscription)");
		expect(apiKeyEntry?.name).toBe("Meta Model API");
	});
});

describe("resolveLoginProviderArg", () => {
	const options = [
		{ id: "meta", name: "Muse Code (subscription)", authType: "oauth" as const },
		{ id: "openai-codex", name: "ChatGPT (subscription)", authType: "oauth" as const },
		{ id: "anthropic", name: "Anthropic", authType: "api_key" as const },
	];

	it("matches exact provider id case-insensitively", () => {
		expect(resolveLoginProviderArg("meta", options)?.id).toBe("meta");
		expect(resolveLoginProviderArg("META", options)?.id).toBe("meta");
	});

	it("matches an unambiguous display-name substring", () => {
		expect(resolveLoginProviderArg("muse", options)?.id).toBe("meta");
	});

	it("returns undefined for unknown or ambiguous input", () => {
		expect(resolveLoginProviderArg("nope-not-a-provider", options)).toBeUndefined();
		expect(resolveLoginProviderArg("subscription", options)).toBeUndefined();
		expect(resolveLoginProviderArg("", options)).toBeUndefined();
	});
});
