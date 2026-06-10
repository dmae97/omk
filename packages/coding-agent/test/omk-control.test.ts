import { describe, expect, test } from "vitest";
import {
	formatAliasedEnvLabel,
	getComposerLiftRows,
	isAliasedEnvFlagEnabled,
	readAliasedEnv,
	resolveRuntimeAppName,
	resolveRuntimeConfigDir,
} from "../src/config.ts";
import {
	buildOmkControlAsciiLogo,
	buildOmkControlDecision,
	buildOmkControlFeatureStrip,
	buildOmkControlMatrixRain,
	buildOmkControlSurface,
	classifyOmkTurnIntent,
	formatOmkTuiDoctorReport,
	inferOmkTurnRisk,
	isOmkRuntimeName,
	resolveOmkTuiEnvironment,
	summarizeOmkLoadedResources,
	truncateOmkExpandedResourceBody,
} from "../src/core/omk-control.ts";
import { BUILTIN_SLASH_COMMANDS, findBuiltinSlashCommand, parseSlashCommandInput } from "../src/core/slash-commands.ts";

describe("OMK control algorithms", () => {
	test("classifies intent and risk for merge-style implementation prompts", () => {
		expect(classifyOmkTurnIntent("merge the TUI and fix the failing checks", "coordinator")).toBe("debugging");
		expect(inferOmkTurnRisk("merge the TUI and run build checks")).toBe("merge");
	});

	test("builds conservative capability routing decisions", () => {
		const readDecision = buildOmkControlDecision("review docs only", "reviewer");
		expect(readDecision.readOnly).toBe(true);
		expect(readDecision.capabilities).toEqual(["read"]);
		expect(readDecision.sandboxMode).toBe("read-only");

		const mergeDecision = buildOmkControlDecision("merge upstream worktree changes", "coordinator");
		expect(mergeDecision.readOnly).toBe(false);
		expect(mergeDecision.capabilities).toEqual(["write", "patch", "shell", "merge"]);
		expect(mergeDecision.evidenceRequired).toBe(true);
	});

	test("formats OMK startup ASCII logo copy", () => {
		const logo = buildOmkControlAsciiLogo().join("\n");

		expect(logo).toContain("OMK://CONTROL");
		expect(logo).toContain("OPEN MULTI-AGENT KIT");
		expect(logo).toContain("CYBERPUNK OPS");
		expect(logo).toContain("ROUTE · VERIFY · LOOP · CONTROL");
		expect(logo).toContain("metrics wall online");
		expect(buildOmkControlMatrixRain().join("\n")).toContain("MATRIX RAIN");
		expect(buildOmkControlFeatureStrip().join("\n")).toContain("Evidence-first");
	});

	test("formats OMK-owned control surface copy", () => {
		const surface = buildOmkControlSurface("implement provider-neutral routing");
		const copy = [surface.compactStatus, surface.expandedStatus, surface.onboarding, surface.footerLabel].join("\n");

		expect(surface.compactStatus).toContain("OMK//CONTROL");
		expect(surface.compactStatus).toContain("route/verify/loop/control");
		expect(surface.expandedStatus).toContain("OMK//CONTROL");
		expect(surface.onboarding).toContain("operator control plane");
		expect(surface.onboarding).toContain("orchestration loops observable");
		expect(surface.onboarding).not.toContain("hard-forked");
		expect(copy).not.toContain("open-multi-agent-kit");
	});

	test("compacts loaded resource summaries for startup surfaces", () => {
		expect(summarizeOmkLoadedResources(["zeta", "alpha", "beta", "gamma", "delta"])).toBe(
			"5 loaded · alpha, beta, delta, gamma, +1 more",
		);
		expect(
			summarizeOmkLoadedResources(
				["~/AGENTS.md", "~/.omk/prompts/root.md", "~/.omk/agent/prompts/omk-parallel-goal.md"],
				{
					sort: false,
					maxItems: 2,
				},
			),
		).toBe("3 loaded · ~/AGENTS.md, ~/.omk/prompts/root.md, +1 more");
	});

	test("caps expanded startup resource bodies for OMK", () => {
		const body = Array.from({ length: 12 }, (_, index) => `  line-${index + 1}`).join("\n");
		expect(truncateOmkExpandedResourceBody(body, 4)).toBe(
			"  line-1\n  line-2\n  line-3\n  line-4\n  … 8 more entries",
		);
	});

	test("publishes registry-backed direct runtime slash commands", () => {
		const commands = new Map(BUILTIN_SLASH_COMMANDS.map((command) => [command.name, command]));
		expect(commands.get("model")).toMatchObject({ group: "provider", usage: "/model [provider/model]" });
		expect(commands.get("think")).toMatchObject({
			group: "mode",
			usage: "/think [off|minimal|low|medium|high|xhigh|max]",
		});
		expect(commands.get("theme")).toMatchObject({ group: "ui", usage: "/theme [theme-name]" });
		expect(commands.get("panel")).toMatchObject({ group: "ui", usage: "/panel [pin|hide|compact|wide]" });
		expect(commands.get("doctor")).toMatchObject({ group: "runtime", usage: "/doctor [tui]" });
		expect(commands.get("brand")).toMatchObject({ group: "ui", usage: "/brand" });
		expect(findBuiltinSlashCommand("t")?.name).toBe("think");
		expect(parseSlashCommandInput("/think set high")).toEqual({
			raw: "/think set high",
			name: "think",
			args: ["set", "high"],
			argsText: "set high",
		});
	});

	test("resolves OMK TUI fullscreen opt-out environment", () => {
		expect(resolveOmkTuiEnvironment({})).toEqual({
			fullscreenEnabled: true,
			tmuxAltScreenAutoEnabled: true,
		});
		expect(resolveOmkTuiEnvironment({ fullscreen: "0" })).toEqual({
			fullscreenEnabled: false,
			tmuxAltScreenAutoEnabled: true,
			disabledReason: "OMK_FULLSCREEN=0",
		});
		expect(resolveOmkTuiEnvironment({ noAltScreen: "1", tmuxAltScreenAuto: "0" })).toEqual({
			fullscreenEnabled: false,
			tmuxAltScreenAutoEnabled: false,
			disabledReason: "OMK_NO_ALT_SCREEN",
		});
		expect(resolveOmkTuiEnvironment({ tmuxAltScreenAuto: "off" })).toEqual({
			fullscreenEnabled: true,
			tmuxAltScreenAutoEnabled: false,
		});
	});

	test("formats OMK TUI doctor report", () => {
		expect(
			formatOmkTuiDoctorReport({
				terminal: "xterm-256color",
				tmux: true,
				tmuxAlternateScreen: "off -> auto-enabled",
				fullscreen: "active",
				sidebar: "pin",
				diagnostics: "fullscreen:on tmux-alt:off->window-on sidebar:pinned",
				envOverrides: ["OMK_TMUX_ALT_SCREEN_AUTO=0"],
			}),
		).toBe(
			[
				"TUI",
				"  terminal: xterm-256color",
				"  tmux: yes",
				"  tmux alternate-screen: off -> auto-enabled",
				"  fullscreen: active",
				"  sidebar: pin",
				"  diagnostics: fullscreen:on tmux-alt:off->window-on sidebar:pinned",
				"  env: OMK_TMUX_ALT_SCREEN_AUTO=0",
			].join("\n"),
		);
	});
});

describe("OMK runtime identity", () => {
	test("resolves invocations to the hardforked omk identity", () => {
		expect(resolveRuntimeAppName(undefined, "/usr/local/bin/pi", {})).toBe("omk");
		expect(resolveRuntimeAppName(undefined, "/usr/local/bin/omk", {})).toBe("omk");
		expect(resolveRuntimeAppName(undefined, "/usr/local/bin/pi", { OMK_CODING_AGENT: "true" })).toBe("omk");
		expect(resolveRuntimeAppName("custom", "/usr/local/bin/omk", {})).toBe("custom");
	});

	test("uses .omk for the hardforked runtime identity", () => {
		expect(resolveRuntimeConfigDir(".pi", "pi")).toBe(".omk");
		expect(resolveRuntimeConfigDir(".pi", "omk")).toBe(".omk");
		expect(resolveRuntimeConfigDir(".custom", "omk")).toBe(".custom");
		expect(isOmkRuntimeName("omk")).toBe(true);
		expect(isOmkRuntimeName("open-multi-agent-kit")).toBe(false);
	});
	test("uses OMK env names without PI legacy aliases", () => {
		expect(readAliasedEnv(["OMK_OFFLINE"], { PI_OFFLINE: "1" })).toBeUndefined();
		expect(isAliasedEnvFlagEnabled(["OMK_OFFLINE"], { OMK_OFFLINE: "true" })).toBe(true);
		expect(formatAliasedEnvLabel("OMK_OFFLINE", ["OMK_OFFLINE"])).toBe("OMK_OFFLINE");
	});

	test("clamps OMK composer lift rows from the environment", () => {
		expect(getComposerLiftRows({})).toBe(0);
		expect(getComposerLiftRows({ OMK_COMPOSER_LIFT_ROWS: "4" })).toBe(4);
		expect(getComposerLiftRows({ OMK_COMPOSER_LIFT_ROWS: "-2" })).toBe(0);
		expect(getComposerLiftRows({ OMK_COMPOSER_LIFT_ROWS: "99" })).toBe(8);
		expect(getComposerLiftRows({ OMK_COMPOSER_LIFT_ROWS: "nope" })).toBe(0);
	});
});
