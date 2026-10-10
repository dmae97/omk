import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { journalPath } from "../src/core/verified-run/journal.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "explain-cli-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("explains through the real source CLI and rejects execution flags without changing the journal", async () => {
	const fixture = dagFixture(root);
	await fixture.coordinator.start(fixture.contract, fixture.command, fixture.approval);
	const before = readFileSync(journalPath(fixture.runPath));
	const cli = (extra: string[]) =>
		spawnSync(
			process.execPath,
			[
				"--import",
				"tsx",
				"packages/coding-agent/src/cli.ts",
				"run",
				"explain",
				"dag",
				"--state-dir",
				fixture.stateRoot,
				...extra,
			],
			{
				cwd: fileURLToPath(new URL("../../../", import.meta.url)),
				env: { PATH: process.env.PATH, HOME: root, OMK_OFFLINE: "1", OMK_SKIP_VERSION_CHECK: "1" },
				encoding: "utf8",
				timeout: 30000,
				maxBuffer: 1048576,
			},
		);
	const result = cli(["--json"]);
	expect(result.status, result.stderr).toBe(0);
	const parsed = JSON.parse(result.stdout);
	expect(parsed).toMatchObject({ runId: "dag", executionRequested: false, proof: { verdict: "verified" } });
	expect(parsed).toEqual(fixture.coordinator.explain("dag"));
	for (const extra of [["--execute"], ["--approve", "a".repeat(64)], ["--json", "--json"]])
		expect(cli(extra).status).toBe(2);
	expect(readFileSync(journalPath(fixture.runPath))).toEqual(before);
	const digest = fixture.coordinator.evidence("dag").checks[0].receiptCoreDigest;
	expect(digest).toMatch(/^[a-f0-9]{64}$/);
	writeFileSync(join(fixture.runPath, "receipts", `${digest}.json`), '{"verified":true}');
	const damaged = cli(["--json"]);
	expect(damaged.status).toBe(1);
	expect(damaged.stderr).toContain("verified-run:");
	expect(damaged.stdout).not.toContain('"verified"');
	expect(readFileSync(journalPath(fixture.runPath))).toEqual(before);
}, 60000);
