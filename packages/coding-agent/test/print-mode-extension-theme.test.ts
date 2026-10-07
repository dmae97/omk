import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { initTheme, setLazyThemeName, theme } from "../src/modes/interactive/theme/theme.ts";

// Print/json mode no longer calls initTheme() eagerly (spec 024), but the no-UI
// extension context still hands out ctx.ui.theme. Before the lazy proxy this threw
// "Theme not initialized", and examples/extensions/sandbox caught it in its
// session_start try/catch and silently disabled the sandbox.
const SANDBOX_LIKE_EXTENSION = `
export default function (omk) {
	omk.on("session_start", async (_event, ctx) => {
		const probe = globalThis.__printThemeProbe;
		try {
			// examples/extensions/sandbox/index.ts: initialize, then report status via the theme.
			probe.sandboxEnabled = true;
			const status = ctx.ui.theme.fg("accent", "Sandbox: 0 domains, 0 write paths");
			ctx.ui.setStatus("sandbox", status);
			probe.status = status;
			probe.themeName = ctx.ui.theme.name;
		} catch (err) {
			probe.sandboxEnabled = false;
			probe.error = err instanceof Error ? err.message : String(err);
		}
	});
}
`;

const THEME_KEY = Symbol.for("open-multi-agent-kit:theme");

interface ThemeProbe {
	sandboxEnabled?: boolean;
	status?: string;
	themeName?: string;
	error?: string;
}

function resetGlobalTheme(): void {
	delete (globalThis as Record<symbol, unknown>)[THEME_KEY];
	setLazyThemeName(undefined);
}

describe("print mode extensions reading ctx.ui.theme", () => {
	let tempDir: string;
	let probe: ThemeProbe;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-print-theme-"));
		probe = {};
		(globalThis as { __printThemeProbe?: ThemeProbe }).__printThemeProbe = probe;
		resetGlobalTheme();
	});

	afterEach(() => {
		delete (globalThis as { __printThemeProbe?: ThemeProbe }).__printThemeProbe;
		resetGlobalTheme();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function createPrintRunner(): Promise<ExtensionRunner> {
		const extensionsDir = path.join(tempDir, ".omk", "extensions");
		fs.mkdirSync(extensionsDir, { recursive: true });
		const extensionPath = path.join(extensionsDir, "sandbox-like.ts");
		fs.writeFileSync(extensionPath, SANDBOX_LIKE_EXTENSION);
		const result = await discoverAndLoadExtensions([extensionPath], tempDir, tempDir);
		expect(result.errors).toEqual([]);
		const runner = new ExtensionRunner(
			result.extensions,
			result.runtime,
			tempDir,
			SessionManager.inMemory(),
			ModelRegistry.create(AuthStorage.create(path.join(tempDir, "auth.json"))),
		);
		// What print/json mode binds: no UI context.
		runner.setUIContext(undefined, "print");
		expect(runner.hasUI()).toBe(false);
		return runner;
	}

	it("keeps the sandbox-style extension enabled without an eager initTheme()", async () => {
		const runner = await createPrintRunner();
		expect((globalThis as Record<symbol, unknown>)[THEME_KEY]).toBeUndefined();

		await runner.emit({ type: "session_start", reason: "startup" });

		expect(probe.error).toBeUndefined();
		expect(probe.sandboxEnabled).toBe(true);
		expect(probe.status).toMatch(/^\x1b\[38;[25];.*Sandbox: 0 domains, 0 write paths\x1b\[39m$/);
	});

	it("lazily loads the theme configured for print mode", async () => {
		initTheme("light");
		const configuredName = theme.name;
		resetGlobalTheme();

		setLazyThemeName("light");
		const runner = await createPrintRunner();
		await runner.emit({ type: "session_start", reason: "startup" });

		expect(probe.sandboxEnabled).toBe(true);
		expect(probe.themeName).toBe(configuredName);
	});
});
