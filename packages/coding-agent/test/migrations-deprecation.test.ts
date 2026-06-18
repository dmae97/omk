import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import {
	applyExtensionMigrationPlan,
	createExtensionMigrationPlan,
	getExtensionDeprecationDiagnostics,
	runMigrations,
} from "../src/migrations.ts";

function withAgentDir<T>(agentDir: string, fn: () => T): T {
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

function withEventLog<T>(logPath: string, fn: () => T): T {
	const previousEventLog = process.env.OMK_HARNESS_CONTROL_EVENT_LOG;
	process.env.OMK_HARNESS_CONTROL_EVENT_LOG = logPath;
	try {
		return fn();
	} finally {
		if (previousEventLog === undefined) {
			delete process.env.OMK_HARNESS_CONTROL_EVENT_LOG;
		} else {
			process.env.OMK_HARNESS_CONTROL_EVENT_LOG = previousEventLog;
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

	it("warns for modern module extension source suffixes", () => {
		const root = createTempDir();
		const agentDir = path.join(root, "agent");
		fs.mkdirSync(path.join(agentDir, "hooks"), { recursive: true });
		fs.writeFileSync(path.join(agentDir, "hooks", "legacy.mjs"), "export default function () {}\n");

		const warnings = withAgentDir(agentDir, () => runMigrations(root).deprecationWarnings);

		expect(warnings).toContain("Global hooks/ directory found. Hooks have been renamed to extensions.");
	});

	it("checks pi and omk manifests independently", () => {
		const root = createTempDir();
		const agentDir = path.join(root, "agent");
		const legacyDir = path.join(agentDir, "hooks", "legacy-manifest");
		fs.mkdirSync(legacyDir, { recursive: true });
		fs.writeFileSync(
			path.join(legacyDir, "package.json"),
			JSON.stringify({ pi: { name: "no legacy arrays" }, omk: { extensions: ["./extension.mjs"] } }),
		);

		const warnings = withAgentDir(agentDir, () => runMigrations(root).deprecationWarnings);

		expect(warnings).toContain("Global hooks/ directory found. Hooks have been renamed to extensions.");
	});

	it("reports malformed package manifests as unknown diagnostics without legacy warning", () => {
		const root = createTempDir();
		const agentDir = path.join(root, "agent");
		const malformedDir = path.join(agentDir, "hooks", "malformed");
		fs.mkdirSync(malformedDir, { recursive: true });
		fs.writeFileSync(path.join(malformedDir, "package.json"), "{not json");

		const warnings = withAgentDir(agentDir, () => runMigrations(root).deprecationWarnings);
		const diagnostics = withAgentDir(agentDir, () => getExtensionDeprecationDiagnostics(root));

		expect(warnings).not.toContain("Global hooks/ directory found. Hooks have been renamed to extensions.");
		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "LEGACY_EXTENSION_UNKNOWN",
				scope: "global",
				classification: "unknown",
			}),
		);
	});

	it("warns when hooks directories contain legacy extension entrypoints", () => {
		const root = createTempDir();
		const agentDir = path.join(root, "agent");
		fs.mkdirSync(path.join(agentDir, "hooks", "legacy"), { recursive: true });
		fs.writeFileSync(path.join(agentDir, "hooks", "legacy", "index.ts"), "export default function () {}\n");

		const warnings = withAgentDir(agentDir, () => runMigrations(root).deprecationWarnings);

		expect(warnings).toContain("Global hooks/ directory found. Hooks have been renamed to extensions.");
	});

	it("creates and applies a dry-run migration plan for legacy extension files", () => {
		const root = createTempDir();
		const agentDir = path.join(root, "agent");
		const legacyPath = path.join(agentDir, "hooks", "legacy.mjs");
		fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
		fs.writeFileSync(legacyPath, "export default function () {}\n");

		const logPath = path.join(root, "events.jsonl");
		const plan = withEventLog(logPath, () => withAgentDir(agentDir, () => createExtensionMigrationPlan(root)));

		expect(plan.actions).toContainEqual(
			expect.objectContaining({
				from: legacyPath,
				to: path.join(agentDir, "extensions", "legacy.mjs"),
				status: "ready",
			}),
		);
		expect(fs.existsSync(legacyPath)).toBe(true);
		expect(fs.readFileSync(logPath, "utf-8")).toContain("extension.migration.plan");

		const applied = withEventLog(logPath, () =>
			withAgentDir(agentDir, () => applyExtensionMigrationPlan(root, plan)),
		);

		expect(applied.actions).toContainEqual(expect.objectContaining({ from: legacyPath, status: "applied" }));
		expect(fs.readFileSync(logPath, "utf-8")).toContain("extension.migration.apply");
		expect(fs.existsSync(legacyPath)).toBe(false);
		expect(fs.existsSync(path.join(agentDir, "extensions", "legacy.mjs"))).toBe(true);
	});

	it("bounds recursive scans and does not migrate symlinks outside hooks", () => {
		const root = createTempDir();
		const agentDir = path.join(root, "agent");
		const outsideDir = path.join(root, "outside");
		const hooksDir = path.join(agentDir, "hooks");
		fs.mkdirSync(outsideDir, { recursive: true });
		fs.mkdirSync(hooksDir, { recursive: true });
		fs.writeFileSync(path.join(outsideDir, "external.mjs"), "export default function () {}\n");
		fs.symlinkSync(outsideDir, path.join(hooksDir, "external"), "dir");

		const plan = withAgentDir(agentDir, () => createExtensionMigrationPlan(root));

		expect(plan.actions).toEqual([]);
		expect(plan.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "LEGACY_EXTENSION_UNKNOWN",
				classification: "unknown",
				evidence: ["symlink target outside hooks directory"],
			}),
		);
	});
});
