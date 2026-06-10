import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleWidth } from "@earendil-works/omk-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAvailableThemes,
	getAvailableThemesWithPaths,
	initTheme,
	setRegisteredThemes,
	theme,
} from "../src/modes/interactive/theme/theme.ts";

type ThemeFile = {
	name: string;
	vars?: Record<string, string | number>;
	colors: Record<string, string | number>;
};

type ThemeProbeOptions = {
	omk: boolean;
	colorFgBg?: string;
	explicitTheme?: string;
};

function runThemeProbe(tempRoot: string, options: ThemeProbeOptions): string {
	const scriptPath = join(tempRoot, `theme-probe-${Math.random().toString(36).slice(2)}.mjs`);
	const themeModuleUrl = new URL("../src/modes/interactive/theme/theme.ts", import.meta.url).href;
	const script = options.explicitTheme
		? `import { initTheme, theme } from ${JSON.stringify(themeModuleUrl)};\ninitTheme(${JSON.stringify(options.explicitTheme)});\nprocess.stdout.write(theme.name ?? "");\n`
		: `import { initTheme, theme } from ${JSON.stringify(themeModuleUrl)};\ninitTheme();\nprocess.stdout.write(theme.name ?? "");\n`;
	writeFileSync(scriptPath, script);

	const env: NodeJS.ProcessEnv = { ...process.env };
	if (options.omk) {
		env.OMK_CODING_AGENT = "true";
	} else {
		delete env.OMK_CODING_AGENT;
	}
	if (options.colorFgBg) {
		env.COLORFGBG = options.colorFgBg;
	} else {
		delete env.COLORFGBG;
	}

	const result = spawnSync(process.execPath, ["--experimental-strip-types", scriptPath], {
		cwd: process.cwd(),
		env,
		encoding: "utf-8",
	});
	if (result.status !== 0) {
		throw new Error(`Theme probe failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
	}
	return result.stdout.trim();
}

describe("theme picker", () => {
	let tempRoot: string;

	beforeEach(() => {
		tempRoot = mkdtempSync(join(tmpdir(), "pi-theme-picker-"));
		const agentDir = join(tempRoot, "agent");
		vi.stubEnv("OMK_CODING_AGENT_DIR", agentDir);
		mkdirSync(join(agentDir, "themes"), { recursive: true });
		setRegisteredThemes([]);
	});

	afterEach(() => {
		setRegisteredThemes([]);
		rmSync(tempRoot, { recursive: true, force: true });
		vi.unstubAllEnvs();
	});

	it("includes OMK built-in themes", () => {
		const omkControlPath = fileURLToPath(new URL("../src/modes/interactive/theme/omk-control.json", import.meta.url));
		const omkRustPath = fileURLToPath(new URL("../src/modes/interactive/theme/omk-rust.json", import.meta.url));

		expect(getAvailableThemes()).toEqual(expect.arrayContaining(["dark", "light", "omk-control", "omk-rust"]));
		expect(getAvailableThemesWithPaths()).toContainEqual({ name: "omk-control", path: omkControlPath });
		expect(getAvailableThemesWithPaths()).toContainEqual({ name: "omk-rust", path: omkRustPath });
	});

	it("keeps omk-control aligned to the cyberpunk matrix brand palette", () => {
		const themeJson = JSON.parse(
			readFileSync(new URL("../src/modes/interactive/theme/omk-control.json", import.meta.url), "utf-8"),
		) as ThemeFile;

		expect(themeJson.vars).toMatchObject({
			bg: "#000408",
			cyan: "#08D3FA",
			matrix: "#08DF69",
			magenta: "#FC6EFF",
			amber: "#FCEE09",
		});
		expect(themeJson.colors.accent).toBe("cyan");
		expect(themeJson.colors.success).toBe("matrix");
		expect(themeJson.colors.warning).toBe("amber");
	});

	it("defaults to omk-control only for the omk runtime without an explicit theme", () => {
		expect(runThemeProbe(tempRoot, { omk: true, colorFgBg: "0;15" })).toBe("omk-control");
		expect(runThemeProbe(tempRoot, { omk: false, colorFgBg: "0;15" })).toBe("light");
		expect(runThemeProbe(tempRoot, { omk: false, colorFgBg: "15;0" })).toBe("dark");
		expect(runThemeProbe(tempRoot, { omk: true, explicitTheme: "light" })).toBe("light");
	});

	it("resolves OMK neon theme aliases to omk-control", () => {
		expect(runThemeProbe(tempRoot, { omk: true, explicitTheme: "omk-control-grid-dark" })).toBe("omk-control");
		expect(runThemeProbe(tempRoot, { omk: true, explicitTheme: "neon-grid" })).toBe("omk-control");
		expect(runThemeProbe(tempRoot, { omk: true, explicitTheme: "green-rain" })).toBe("omk-control");
	});

	it("resolves Rust theme aliases to omk-rust", () => {
		expect(runThemeProbe(tempRoot, { omk: true, explicitTheme: "rust" })).toBe("omk-rust");
		expect(runThemeProbe(tempRoot, { omk: true, explicitTheme: "oxide" })).toBe("omk-rust");
		expect(runThemeProbe(tempRoot, { omk: true, explicitTheme: "ferris" })).toBe("omk-rust");
	});

	it("renders theme gradients without changing visible width", () => {
		initTheme("omk-control", false);
		const text = "OMK//CONTROL::PRIME";
		const styled = theme.gradient("accent", "borderAccent", text);
		expect(styled).toContain("\u001b[38;");
		expect(visibleWidth(styled)).toBe(visibleWidth(text));
	});

	it("renders Rust theme gradients without changing visible width", () => {
		initTheme("omk-rust", false);
		const text = "cargo build --release";
		const styled = theme.gradient("accent", "warning", text);
		expect(styled).toContain("\u001b[38;");
		expect(visibleWidth(styled)).toBe(visibleWidth(text));
	});

	it("uses custom theme content names instead of file names", () => {
		const darkTheme = JSON.parse(
			readFileSync(new URL("../src/modes/interactive/theme/dark.json", import.meta.url), "utf-8"),
		) as ThemeFile;
		const customTheme: ThemeFile = {
			...darkTheme,
			name: "bar",
		};

		const themePath = join(process.env.OMK_CODING_AGENT_DIR!, "themes", "foo.json");
		writeFileSync(themePath, JSON.stringify(customTheme, null, 2));

		expect(getAvailableThemes()).toContain("bar");
		expect(getAvailableThemes()).not.toContain("foo");
		expect(getAvailableThemesWithPaths()).toContainEqual({ name: "bar", path: themePath });
		expect(getAvailableThemesWithPaths().some((theme) => theme.name === "foo")).toBe(false);
	});
});
