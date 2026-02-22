import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { renameApprovedPlanFile } from "@oh-my-pi/pi-coding-agent/plan-mode/approved-plan";

describe("renameApprovedPlanFile", () => {
	let tmpDir: string;
	let artifactsDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "approved-plan-"));
		artifactsDir = path.join(tmpDir, "artifacts");
		await fs.mkdir(path.join(artifactsDir, "local"), { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	function options(planFilePath: string, finalPlanFilePath: string) {
		return {
			planFilePath,
			finalPlanFilePath,
			getArtifactsDir: () => artifactsDir,
			getSessionId: () => "session-z",
		};
	}

	it("fails with actionable error when destination already exists", async () => {
		await Bun.write(path.join(artifactsDir, "local", "PLAN.md"), "draft");
		await Bun.write(path.join(artifactsDir, "local", "WP_MIGRATION_PLAN.md"), "existing");

		await expect(renameApprovedPlanFile(options("local://PLAN.md", "local://WP_MIGRATION_PLAN.md"))).rejects.toThrow(
			"Plan destination already exists at local://WP_MIGRATION_PLAN.md",
		);
	});

	it("renames PLAN.md to titled artifact path", async () => {
		await Bun.write(path.join(artifactsDir, "local", "PLAN.md"), "draft body");

		await renameApprovedPlanFile(options("local://PLAN.md", "local://WP_MIGRATION_PLAN.md"));

		expect(await Bun.file(path.join(artifactsDir, "local", "WP_MIGRATION_PLAN.md")).text()).toBe("draft body");
		await expect(fs.stat(path.join(artifactsDir, "local", "PLAN.md"))).rejects.toThrow();
	});
});
