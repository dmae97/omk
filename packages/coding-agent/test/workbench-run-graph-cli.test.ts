import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AuthorityStore, authorityStorePath } from "../src/core/verified-run/authority-store.ts";
import { journalPath } from "../src/core/verified-run/journal.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "workbench-cli-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function cli(stateRoot: string, extra: string[] = [], id = "dag") {
	return spawnSync(
		process.execPath,
		["--import", "tsx", "packages/coding-agent/src/cli.ts", "run", "graph", id, "--state-dir", stateRoot, ...extra],
		{
			cwd: fileURLToPath(new URL("../../../", import.meta.url)),
			env: { PATH: process.env.PATH, HOME: root, OMK_OFFLINE: "1", OMK_SKIP_VERSION_CHECK: "1" },
			encoding: "utf8",
			timeout: 30000,
			maxBuffer: 1048576,
		},
	);
}

it("reads a real run through the source CLI, reconnects and never accepts execution flags", async () => {
	const f = dagFixture(root, true);
	await f.coordinator.start(f.contract, f.command, f.approval);
	const before = readFileSync(journalPath(f.runPath));
	const result = cli(f.stateRoot, ["--json"]);
	expect(result.status, result.stderr).toBe(0);
	const graph = JSON.parse(result.stdout);
	expect(graph).toMatchObject({ schemaVersion: "omk.run-graph.v1", runtime: "node", executionRequested: false });
	expect(graph.proofVerdict).toBe("inconclusive");
	expect(graph.edges).toHaveLength(2);
	expect(cli(f.stateRoot).stdout).toBe(result.stdout);
	for (const extra of [["--execute"], ["--approve", "a".repeat(64)], ["--json", "--json"]])
		expect(cli(f.stateRoot, extra).status).toBe(2);
	expect(readFileSync(journalPath(f.runPath))).toEqual(before);
	const missing = join(root, "missing");
	expect(cli(missing, [], "unknown").status).toBe(1);
	expect(existsSync(missing)).toBe(false);
}, 60000);

it("rejects damaged evidence instead of emitting a healthy graph", async () => {
	const f = dagFixture(root);
	await f.coordinator.start(f.contract, f.command, f.approval);
	const digest = f.coordinator.evidence("dag").checks[0].receiptCoreDigest;
	writeFileSync(join(f.runPath, "receipts", `${digest}.json`), '{"verified":true}');
	const result = cli(f.stateRoot);
	expect(result.status).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr).toContain("verified-run:");
}, 60000);

it("identifies authority-only proof changes without changing the run journal", async () => {
	const f = dagFixture(root);
	await f.coordinator.start(f.contract, f.command, f.approval);
	const before = readFileSync(journalPath(f.runPath));
	const observe = () => {
		const result = cli(f.stateRoot);
		expect(result.status, result.stderr).toBe(0);
		return JSON.parse(result.stdout);
	};
	const initial = observe();
	const store = AuthorityStore.open(authorityStorePath(f.stateRoot), { capacity: 16 });
	try {
		store.reconcile();
		const incarnation = store.register("dag");
		const grant = store.acquire({
			sessionId: "dag",
			incarnation,
			commandId: "observation-reservation",
			intentDigest: "a".repeat(64),
			claims: [{ namespace: "git-ref", instanceId: "test", canonicalKey: "ref", access: "write", generation: "0" }],
			now: Date.now(),
			ttl: 60_000,
		});
		if (grant.status !== "granted") throw new Error("authority fixture refused");
		const reserved = observe();
		expect(store.cancel(grant.token)).toBe(true);
		const cancelled = observe();
		expect([initial.proofVerdict, reserved.proofVerdict, cancelled.proofVerdict]).toEqual([
			"verified",
			"inconclusive",
			"verified",
		]);
		expect([reserved.cursor.revision, cancelled.cursor.revision]).toEqual([
			initial.cursor.revision,
			initial.cursor.revision,
		]);
		expect(new Set([initial, reserved, cancelled].map((graph) => JSON.stringify(graph.cursor))).size).toBe(3);
		expect(reserved.cursor.authorityRevision).toBeGreaterThan(initial.cursor.authorityRevision);
		expect(cancelled.cursor.authorityRevision).toBeGreaterThan(reserved.cursor.authorityRevision);
		expect(store.compact(Date.now()).dropped).toBeGreaterThan(0);
		const compacted = observe();
		expect(compacted.proofVerdict).toBe("verified");
		expect(compacted.cursor.revision).toBe(initial.cursor.revision);
		expect(compacted.cursor.authorityRevision).toBeGreaterThan(cancelled.cursor.authorityRevision);
		expect(readFileSync(journalPath(f.runPath))).toEqual(before);
	} finally {
		store.release();
	}
}, 60000);
