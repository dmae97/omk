import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { runMigrations } from "../src/migrations.ts";

function withAgentDir(agentDir: string, fn: () => string[]): string[] {
	const previousAgentDir = process.env[ENV_AGENT_DIR];
	process.env[ENV_AGENT_DIR] = agentDir;
	try {
		return fn();
	} finally {
		if (previousAgentDir === undefined) {
			delete process.env[ENV_AGENT_DIR];
		} else {
			process.env[ENV_AGENT_DIR] = previousAgentDir;
		}
	}
}

describe("extension deprecation migrations", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	function createTempDir(): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-migrations-deprecation-"));
		tempDirs.push(dir);
		return dir;
	}

	it("does not warn for shell guard scripts in hooks directories", () => {
		const root = createTempDir();
		const agentDir = path.join(root, "agent");
		fs.mkdirSync(path.join(agentDir, "hooks"), { recursive: true });
		fs.writeFileSync(path.join(agentDir, "hooks", "pre-shell-guard.sh"), "#!/usr/bin/env bash\n");

		const warnings = withAgentDir(agentDir, () => runMigrations(root).deprecationWarnings);

		expect(warnings).not.toContain("Global hooks/ directory found. Hooks have been renamed to extensions.");
	});

	it("warns when hooks directories contain legacy extension entrypoints", () => {
		const root = createTempDir();
		const agentDir = path.join(root, "agent");
		fs.mkdirSync(path.join(agentDir, "hooks", "legacy"), { recursive: true });
		fs.writeFileSync(path.join(agentDir, "hooks", "legacy", "index.ts"), "export default function () {}\n");

		const warnings = withAgentDir(agentDir, () => runMigrations(root).deprecationWarnings);

		expect(warnings).toContain("Global hooks/ directory found. Hooks have been renamed to extensions.");
	});
});
