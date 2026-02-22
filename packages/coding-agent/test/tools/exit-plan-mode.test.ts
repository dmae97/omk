import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { ExitPlanModeTool } from "@oh-my-pi/pi-coding-agent/tools/exit-plan-mode";

describe("ExitPlanModeTool", () => {
	let tmpDir: string;
	let artifactsDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "exit-plan-mode-"));
		artifactsDir = path.join(tmpDir, "artifacts");
		await fs.mkdir(path.join(artifactsDir, "local"), { recursive: true });
		await Bun.write(path.join(artifactsDir, "local", "PLAN.md"), "# Plan\n");
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	function createSession(overrides: Partial<ToolSession> = {}): ToolSession {
		return {
			cwd: tmpDir,
			hasUI: false,
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			settings: Settings.isolated(),
			getArtifactsDir: () => artifactsDir,
			getSessionId: () => "session-a",
			getPlanModeState: () => ({ enabled: true, planFilePath: "local://PLAN.md" }),
			...overrides,
		};
	}

	it("requires title in schema", () => {
		const tool = new ExitPlanModeTool(createSession());
		const schema = tool.parameters as { required?: string[] };
		expect(schema.required).toContain("title");
	});

	it("normalizes title to .md final plan path", async () => {
		const tool = new ExitPlanModeTool(createSession());
		const result = await tool.execute("call-1", { title: "WP_MIGRATION_PLAN" });

		expect(result.details?.planFilePath).toBe("local://PLAN.md");
		expect(result.details?.title).toBe("WP_MIGRATION_PLAN");
		expect(result.details?.finalPlanFilePath).toBe("local://WP_MIGRATION_PLAN.md");
		expect(result.details?.planExists).toBe(true);
	});

	it("accepts explicit .md suffix in title", async () => {
		const tool = new ExitPlanModeTool(createSession());
		const result = await tool.execute("call-2", { title: "WP_MIGRATION_PLAN.md" });
		expect(result.details?.title).toBe("WP_MIGRATION_PLAN");
		expect(result.details?.finalPlanFilePath).toBe("local://WP_MIGRATION_PLAN.md");
	});

	it("rejects invalid title characters", async () => {
		const tool = new ExitPlanModeTool(createSession());
		await expect(tool.execute("call-3", { title: "../bad" })).rejects.toThrow(
			"Title must not contain path separators or '..'.",
		);
		await expect(tool.execute("call-4", { title: "bad name" })).rejects.toThrow(
			"Title may only contain letters, numbers, underscores, or hyphens.",
		);
	});
});
