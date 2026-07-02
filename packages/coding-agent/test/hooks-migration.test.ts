import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { archiveLegacyHooksDir, checkDeprecatedExtensionDirs, runMigrations } from "../src/migrations.ts";

describe("legacy hooks/ migration", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	function tempDir(prefix: string): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		tempDirs.push(dir);
		return dir;
	}

	function writeHook(baseDir: string, name = "custom.sh"): void {
		fs.mkdirSync(path.join(baseDir, "hooks"), { recursive: true });
		fs.writeFileSync(path.join(baseDir, "hooks", name), "#!/bin/sh\n");
	}

	describe("archiveLegacyHooksDir", () => {
		it("renames hooks/ to hooks.migrated/ and preserves contents", () => {
			const base = tempDir("omk-hooks-archive-");
			writeHook(base, "a.sh");

			const archived = archiveLegacyHooksDir(base);

			expect(archived).toBe(path.join(base, "hooks.migrated"));
			expect(fs.existsSync(path.join(base, "hooks"))).toBe(false);
			expect(fs.existsSync(path.join(base, "hooks.migrated", "a.sh"))).toBe(true);
		});

		it("uses a timestamped name when hooks.migrated already exists", () => {
			const base = tempDir("omk-hooks-archive-collision-");
			writeHook(base);
			fs.mkdirSync(path.join(base, "hooks.migrated"), { recursive: true });

			const archived = archiveLegacyHooksDir(base);

			expect(archived).not.toBeNull();
			expect(archived).not.toBe(path.join(base, "hooks.migrated"));
			expect(archived?.startsWith(path.join(base, "hooks.migrated."))).toBe(true);
			expect(fs.existsSync(path.join(base, "hooks"))).toBe(false);
		});

		it("returns null when there is no hooks/ directory", () => {
			const base = tempDir("omk-hooks-archive-none-");
			expect(archiveLegacyHooksDir(base)).toBeNull();
		});
	});

	describe("checkDeprecatedExtensionDirs", () => {
		it("archives project hooks/ instead of warning when autoArchiveHooks is set", () => {
			const base = tempDir("omk-hooks-project-");
			writeHook(base);

			const warnings = checkDeprecatedExtensionDirs(base, "Project", { autoArchiveHooks: true });

			expect(warnings).toEqual([]);
			expect(fs.existsSync(path.join(base, "hooks"))).toBe(false);
			expect(fs.existsSync(path.join(base, "hooks.migrated"))).toBe(true);
		});

		it("warns and preserves global hooks/ when autoArchiveHooks is not set", () => {
			const base = tempDir("omk-hooks-global-");
			writeHook(base);

			const warnings = checkDeprecatedExtensionDirs(base, "Global", { autoArchiveHooks: false });

			expect(warnings.some((w) => w.startsWith("Global hooks/"))).toBe(true);
			expect(fs.existsSync(path.join(base, "hooks"))).toBe(true);
		});
	});

	describe("runMigrations", () => {
		it("auto-archives project .omk/hooks/ and only warns about global hooks/", () => {
			const globalAgentDir = tempDir("omk-global-agent-");
			const projectRoot = tempDir("omk-project-root-");
			const projectConfig = path.join(projectRoot, ".omk");

			// Global hooks: warned about, never archived (may still be live).
			fs.mkdirSync(path.join(globalAgentDir, "hooks"), { recursive: true });
			fs.writeFileSync(path.join(globalAgentDir, "hooks", "g.sh"), "#!/bin/sh\n");
			// Project hooks: auto-archived (never executed).
			fs.mkdirSync(path.join(projectConfig, "hooks"), { recursive: true });
			fs.writeFileSync(path.join(projectConfig, "hooks", "p.sh"), "#!/bin/sh\n");

			const previous = process.env[ENV_AGENT_DIR];
			process.env[ENV_AGENT_DIR] = globalAgentDir;
			try {
				const { deprecationWarnings } = runMigrations(projectRoot);

				// Project hooks archived; no blocking project warning.
				expect(fs.existsSync(path.join(projectConfig, "hooks"))).toBe(false);
				expect(fs.existsSync(path.join(projectConfig, "hooks.migrated", "p.sh"))).toBe(true);
				expect(deprecationWarnings.some((w) => w.startsWith("Project hooks/"))).toBe(false);

				// Global hooks preserved and warned about.
				expect(fs.existsSync(path.join(globalAgentDir, "hooks"))).toBe(true);
				expect(deprecationWarnings.some((w) => w.startsWith("Global hooks/"))).toBe(true);
			} finally {
				if (previous === undefined) delete process.env[ENV_AGENT_DIR];
				else process.env[ENV_AGENT_DIR] = previous;
			}
		});
	});
});
