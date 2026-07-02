import { describe, expect, it } from "vitest";
import {
	COMPUTER_USE_PRESETS,
	type ComputerUsePreset,
	getComputerUsePreset,
	listComputerUsePresets,
	OMK_COMPUTER_USE_DEFAULT_PRESET_ID,
	requiresCredentialedOriginAllowlist,
} from "../src/core/mcp-computer-use-presets.ts";

const expectDetachedClone = (preset: ComputerUsePreset) => {
	const clone = getComputerUsePreset(preset.id);
	expect(clone).toEqual(preset);
	expect(clone).not.toBe(preset);
	expect(clone?.policy).not.toBe(preset.policy);
};

describe("computer-use MCP presets", () => {
	it("uses Playwright MCP as the default computer-use engine", () => {
		expect(OMK_COMPUTER_USE_DEFAULT_PRESET_ID).toBe("playwright-computer-use");
		expect(Object.keys(COMPUTER_USE_PRESETS).sort()).toEqual(["browserUseAgent", "playwrightComputerUse"]);

		const preset = COMPUTER_USE_PRESETS.playwrightComputerUse;
		expect(preset).toMatchObject({
			defaultEnabled: true,
			engine: "mcp",
			id: "playwright-computer-use",
			label: "Playwright Computer Use",
			risk: "R3",
		});
		expect(preset.transport).toMatchObject({
			type: "stdio",
			command: "npx",
			args: expect.arrayContaining([
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
			]),
		});
		expect(preset.policy.allowedOriginsSecurityBoundary).toBe(false);
		expect(preset.policy.blockMetadataIp).toBe(true);
		expect(preset.policy.blockPrivateNetwork).toBe(true);
		expect(preset.policy.denyNoSandbox).toBe(true);
		expect(preset.policy.noUnrestrictedFileAccess).toBe(true);
		expect(preset.policy.originAllowlistRequiredForCredentialedMode).toBe(true);
		expect(preset.policy.requiresExplicitPostconditions).toBe(true);
		expect(preset.policy.requiresRequestInterception).toBe(true);
		expect(preset.supportedLaunchOptions).toEqual(
			expect.arrayContaining(["storage-state", "extension", "cdp-endpoint"]),
		);
	});

	it("declares the four supported cookie and browser session modes", () => {
		const modes = COMPUTER_USE_PRESETS.playwrightComputerUse.browserModes;
		expect(modes.map((mode) => mode.id)).toEqual([
			"managed-chrome-profile",
			"managed-firefox-profile",
			"isolated-storage-state",
			"existing-chrome-session",
		]);
		expect(modes).toEqual([
			expect.objectContaining({
				browser: "chrome",
				cookieMode: "managed-profile",
				id: "managed-chrome-profile",
				profileDir: ".omk/browser-profiles/chrome",
			}),
			expect.objectContaining({
				browser: "firefox",
				cookieMode: "managed-profile",
				id: "managed-firefox-profile",
				profileDir: ".omk/browser-profiles/firefox",
			}),
			expect.objectContaining({
				argsExtra: ["--isolated", "--storage-state", "<storageStatePath>"],
				cookieMode: "isolated-storage-state",
				id: "isolated-storage-state",
			}),
			expect.objectContaining({
				argsExtra: ["--extension"],
				browser: "chrome",
				browserLimit: "chrome-edge-only",
				cookieMode: "existing-browser-session",
				id: "existing-chrome-session",
			}),
		]);
	});

	it("keeps browser-use as an optional advanced brokered engine", () => {
		const preset = COMPUTER_USE_PRESETS.browserUseAgent;
		expect(preset).toMatchObject({
			defaultEnabled: false,
			engine: "python-rust-sidecar",
			id: "browser-use-agent",
			risk: "R3",
		});
		expect(preset.policy.allowedDomainsRequired).toBe(true);
		expect(preset.policy.noManualProfileShellScript).toBe(true);
		expect(preset.policy.profileBrokerOnly).toBe(true);
		expect(preset.policy.requiresExplicitPostconditions).toBe(true);
		expect(preset.policy.secretBrokerOnly).toBe(true);
	});

	it("requires origin allowlists whenever credentials can ride the browser", () => {
		expect(requiresCredentialedOriginAllowlist("none")).toBe(false);
		expect(requiresCredentialedOriginAllowlist("managed-profile")).toBe(true);
		expect(requiresCredentialedOriginAllowlist("isolated-storage-state")).toBe(true);
		expect(requiresCredentialedOriginAllowlist("existing-browser-session")).toBe(true);
	});

	it("returns detached preset clones", () => {
		expect(listComputerUsePresets().map((preset) => preset.id)).toEqual([
			"playwright-computer-use",
			"browser-use-agent",
		]);
		expectDetachedClone(COMPUTER_USE_PRESETS.playwrightComputerUse);
		expectDetachedClone(COMPUTER_USE_PRESETS.browserUseAgent);
		expect(getComputerUsePreset("missing")).toBeUndefined();
	});
});
