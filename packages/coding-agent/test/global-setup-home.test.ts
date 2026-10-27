import { execFileSync } from "node:child_process";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

// test.sh isolates HOME, but the documented one-file command (`vitest --run test/x.test.ts`) and
// `npm test` run vitest directly. Without isolation the resource loader read the developer's
// ~/.agents/skills (docs/skills.md), admitted those skills into every test session, and shifted
// session revisions that tests assert on.
describe("hermetic HOME for direct vitest runs", () => {
	it("points HOME at a throwaway directory instead of the account home", () => {
		const accountHome = userInfo().homedir;
		expect(homedir()).not.toBe(accountHome);
		expect(process.env.HOME).toBe(homedir());
		expect(relative(tmpdir(), homedir()).startsWith("..")).toBe(false);
	});

	it("hands the isolated HOME to processes the tests spawn", () => {
		const childHome = execFileSync(process.execPath, ["-e", "process.stdout.write(require('node:os').homedir())"], {
			encoding: "utf8",
		});
		expect(childHome).toBe(homedir());
	});

	it("resolves user-level agent skills inside the isolated HOME", async () => {
		const cwd = join(tmpdir(), "omk-setup-home-cwd");
		const manager = new DefaultPackageManager({
			cwd,
			agentDir: join(homedir(), ".omk/agent"),
			settingsManager: SettingsManager.inMemory(),
		});
		const resolved = await manager.resolve();
		const accountSkills = join(userInfo().homedir, ".agents", "skills");
		expect(resolved.skills.filter((skill) => skill.path.startsWith(accountSkills))).toEqual([]);
	});
});
