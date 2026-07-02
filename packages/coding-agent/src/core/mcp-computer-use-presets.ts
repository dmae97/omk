export const OMK_COMPUTER_USE_DEFAULT_PRESET_ID = "playwright-computer-use";

export type ComputerUsePresetKey = "browserUseAgent" | "playwrightComputerUse";
export type ComputerUsePresetId = "browser-use-agent" | "playwright-computer-use";
export type ComputerUseRisk = "R3";
export type ComputerUseEngine = "mcp" | "python-rust-sidecar";
export type ComputerUseBrowser = "chrome" | "firefox" | "msedge" | "webkit";
export type ComputerUseCookieMode = "existing-browser-session" | "isolated-storage-state" | "managed-profile" | "none";
export type ComputerUseCredentialScope = "none" | "session" | "workspace";
export type ComputerUseLaunchOption = "browser" | "cdp-endpoint" | "extension" | "storage-state" | "user-data-dir";

export interface ComputerUseTransport {
	readonly args: readonly string[];
	readonly command: string;
	readonly packageName?: string;
	readonly type: "stdio";
}

export interface ComputerUseBrowserMode {
	readonly argsExtra?: readonly string[];
	readonly browser?: ComputerUseBrowser;
	readonly browserLimit?: "chrome-edge-only";
	readonly cookieMode: ComputerUseCookieMode;
	readonly description: string;
	readonly id:
		| "existing-chrome-session"
		| "isolated-storage-state"
		| "managed-chrome-profile"
		| "managed-firefox-profile";
	readonly profileDir?: string;
}

export interface ComputerUsePolicy {
	readonly allowedDomainsRequired?: boolean;
	readonly allowedOriginsSecurityBoundary?: boolean;
	readonly blockMetadataIp: boolean;
	readonly blockPrivateNetwork: boolean;
	readonly credentialScopes: readonly ComputerUseCredentialScope[];
	readonly denyNoSandbox: boolean;
	readonly descriptorHashPinned: boolean;
	readonly evidenceLedger: boolean;
	readonly maxActions: number;
	readonly maxOutputBytes?: number;
	readonly noManualProfileShellScript?: boolean;
	readonly noUnrestrictedFileAccess: boolean;
	readonly originAllowlistRequiredForCredentialedMode: boolean;
	readonly outputGuard: boolean;
	readonly profileBrokerOnly?: boolean;
	readonly requiresExplicitPostconditions: boolean;
	readonly requiresRequestInterception: boolean;
	readonly sandboxRequired: boolean;
	readonly secretBrokerOnly: boolean;
}

export interface ComputerUsePreset {
	readonly browserModes: readonly ComputerUseBrowserMode[];
	readonly defaultEnabled: boolean;
	readonly engine: ComputerUseEngine;
	readonly id: ComputerUsePresetId;
	readonly key: ComputerUsePresetKey;
	readonly label: string;
	readonly notes: readonly string[];
	readonly policy: ComputerUsePolicy;
	readonly risk: ComputerUseRisk;
	readonly sourceUrls: readonly string[];
	readonly supportedLaunchOptions: readonly ComputerUseLaunchOption[];
	readonly transport?: ComputerUseTransport;
}

const PLAYWRIGHT_BROWSER_MODES: readonly ComputerUseBrowserMode[] = [
	{
		browser: "chrome",
		cookieMode: "managed-profile",
		description: "OMK-managed Chrome profile with project-scoped persistent cookies and local storage.",
		id: "managed-chrome-profile",
		profileDir: ".omk/browser-profiles/chrome",
	},
	{
		browser: "firefox",
		cookieMode: "managed-profile",
		description: "OMK-managed Firefox profile; avoids attaching to the user's real Firefox profile.",
		id: "managed-firefox-profile",
		profileDir: ".omk/browser-profiles/firefox",
	},
	{
		argsExtra: ["--isolated", "--storage-state", "<storageStatePath>"],
		cookieMode: "isolated-storage-state",
		description: "Loads cookies and local storage from an explicit Playwright storage-state file.",
		id: "isolated-storage-state",
	},
	{
		argsExtra: ["--extension"],
		browser: "chrome",
		browserLimit: "chrome-edge-only",
		cookieMode: "existing-browser-session",
		description: "Connects to an existing Chrome or Edge session through the Playwright extension.",
		id: "existing-chrome-session",
	},
];

const PLAYWRIGHT_COMPUTER_USE_PRESET: ComputerUsePreset = {
	browserModes: PLAYWRIGHT_BROWSER_MODES,
	defaultEnabled: true,
	engine: "mcp",
	id: "playwright-computer-use",
	key: "playwrightComputerUse",
	label: "Playwright Computer Use",
	notes: [
		"Default computer-use preset built on Microsoft Playwright MCP accessibility-tree automation.",
		"Credentialed browser sessions must go through SecureComputerUseBroker preflight and request interception.",
		"Playwright allowed-origins are recorded as advisory only; OMK policy remains the security boundary.",
	],
	policy: {
		allowedOriginsSecurityBoundary: false,
		blockMetadataIp: true,
		blockPrivateNetwork: true,
		credentialScopes: ["none", "session", "workspace"],
		denyNoSandbox: true,
		descriptorHashPinned: true,
		evidenceLedger: true,
		maxActions: 40,
		maxOutputBytes: 25_000_000,
		noUnrestrictedFileAccess: true,
		originAllowlistRequiredForCredentialedMode: true,
		outputGuard: true,
		requiresExplicitPostconditions: true,
		requiresRequestInterception: true,
		sandboxRequired: true,
		secretBrokerOnly: true,
	},
	risk: "R3",
	sourceUrls: ["https://github.com/microsoft/playwright-mcp"],
	supportedLaunchOptions: ["browser", "user-data-dir", "storage-state", "extension", "cdp-endpoint"],
	transport: {
		args: [
			"-y",
			"@playwright/mcp@0.0.76",
			"--browser",
			"<browser>",
			"--user-data-dir",
			"<profileDir>",
			"--output-dir",
			"<outputDir>",
			"--output-mode",
			"file",
			"--block-service-workers",
			"--timeout-action",
			"5000",
			"--timeout-navigation",
			"60000",
		],
		command: "npx",
		packageName: "@playwright/mcp",
		type: "stdio",
	},
};

const BROWSER_USE_AGENT_PRESET: ComputerUsePreset = {
	browserModes: [],
	defaultEnabled: false,
	engine: "python-rust-sidecar",
	id: "browser-use-agent",
	key: "browserUseAgent",
	label: "Browser Use Agent",
	notes: [
		"Optional advanced runner for agentic browser tasks that need recovery loops or custom tools.",
		"Profiles and secrets must be injected through OMK brokers instead of manual shell profile scripts.",
	],
	policy: {
		allowedDomainsRequired: true,
		blockMetadataIp: true,
		blockPrivateNetwork: true,
		credentialScopes: ["none", "session", "workspace"],
		denyNoSandbox: true,
		descriptorHashPinned: true,
		evidenceLedger: true,
		maxActions: 60,
		noManualProfileShellScript: true,
		noUnrestrictedFileAccess: true,
		originAllowlistRequiredForCredentialedMode: true,
		outputGuard: true,
		profileBrokerOnly: true,
		requiresExplicitPostconditions: true,
		requiresRequestInterception: true,
		sandboxRequired: true,
		secretBrokerOnly: true,
	},
	risk: "R3",
	sourceUrls: ["https://github.com/browser-use/browser-use"],
	supportedLaunchOptions: [],
};

export const COMPUTER_USE_PRESETS: Record<ComputerUsePresetKey, ComputerUsePreset> = {
	playwrightComputerUse: PLAYWRIGHT_COMPUTER_USE_PRESET,
	browserUseAgent: BROWSER_USE_AGENT_PRESET,
} as const;

export function listComputerUsePresets(): ComputerUsePreset[] {
	return Object.values(COMPUTER_USE_PRESETS).map((preset) => cloneComputerUsePreset(preset));
}

export function getComputerUsePreset(id: string): ComputerUsePreset | undefined {
	const preset = Object.values(COMPUTER_USE_PRESETS).find((candidate) => candidate.id === id);
	return preset ? cloneComputerUsePreset(preset) : undefined;
}

export function requiresCredentialedOriginAllowlist(cookieMode: ComputerUseCookieMode): boolean {
	return cookieMode !== "none";
}

function cloneComputerUsePreset(preset: ComputerUsePreset): ComputerUsePreset {
	return {
		...preset,
		browserModes: preset.browserModes.map((mode) => ({
			...mode,
			argsExtra: mode.argsExtra ? [...mode.argsExtra] : undefined,
		})),
		notes: [...preset.notes],
		policy: {
			...preset.policy,
			credentialScopes: [...preset.policy.credentialScopes],
		},
		sourceUrls: [...preset.sourceUrls],
		supportedLaunchOptions: [...preset.supportedLaunchOptions],
		transport: preset.transport
			? {
					...preset.transport,
					args: [...preset.transport.args],
				}
			: undefined,
	};
}
