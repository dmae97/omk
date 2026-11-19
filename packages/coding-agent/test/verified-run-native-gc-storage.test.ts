import fs from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRunAuthority } from "../src/core/verified-run/authority-runtime.ts";
import { journalPath } from "../src/core/verified-run/journal.ts";
import { collectVerifiedRuns } from "../src/core/verified-run/run-gc.ts";
import { nativeRequestId } from "../src/core/verified-run/rust-host-record.ts";
import { settledNativeVerifier } from "./helpers/native-gc.ts";

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
beforeEach(() => {
	if (binary) vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary);
	vi.stubEnv("OMK_RUST_EXECUTION_RECONNECT", "1");
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe.skipIf(!binary)("native GC storage trust", () => {
	it.each([
		"binding",
		"missing-head",
		"tail",
		"symlink",
		"hardlink",
		"shared",
		"incomplete",
		"live-host",
		"temporary",
	])(
		"retains %s records and their workspace",
		async (kind) => {
			const run = await settledNativeVerifier(binary!);
			const id = nativeRequestId(run.executionId);
			const path = join(run.recordDir, `${id}.jsonl`);
			const head = join(run.recordDir, `${id}.head`);
			const original = fs.readFileSync(path);
			const originalHead = fs.readFileSync(head);
			const saved = join(run.root, "saved-record");
			const savedHead = join(run.root, "saved-head");
			const outside = join(run.root, "outside");
			fs.writeFileSync(outside, "precious");
			try {
				if (kind === "symlink" || kind === "hardlink") {
					fs.renameSync(path, saved);
					if (kind === "symlink") fs.symlinkSync(outside, path);
					else fs.linkSync(saved, path);
				} else if (kind === "missing-head") fs.renameSync(head, savedHead);
				else if (kind === "shared") fs.chmodSync(path, 0o644);
				else if (kind === "temporary")
					fs.writeFileSync(join(run.recordDir, `.${id}.head.tmp`), "", { mode: 0o600 });
				else if (kind === "tail") fs.appendFileSync(path, "unpublished\n");
				else {
					const rows = original
						.toString()
						.trimEnd()
						.split("\n")
						.map((line) => JSON.parse(line));
					if (kind === "binding") rows[0].bindingDigest = "f".repeat(64);
					if (kind === "incomplete") rows.pop();
					if (kind === "live-host") {
						rows[0].hostPid = process.pid;
						const stat = fs.readFileSync(`/proc/${process.pid}/stat`, "utf8");
						rows[0].hostTicks = stat
							.slice(stat.lastIndexOf(")") + 2)
							.trim()
							.split(/\s+/)[19];
					}
					const text = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
					fs.writeFileSync(path, text);
					fs.writeFileSync(head, `${Buffer.byteLength(text)}\n`);
				}
				const report = collectVerifiedRuns(run.stateRoot, { olderThanMs: 0, execute: true });
				expect(report.nativeRecords).toContainEqual(expect.objectContaining({ requestId: id, action: "kept" }));
				expect(fs.existsSync(path)).toBe(true);
				expect(fs.existsSync(join(run.runPath, "candidate"))).toBe(true);
				expect(fs.readFileSync(outside, "utf8")).toBe("precious");
			} finally {
				if (fs.existsSync(saved)) {
					fs.unlinkSync(path);
					fs.renameSync(saved, path);
				} else {
					fs.chmodSync(path, 0o600);
					fs.writeFileSync(path, original);
				}
				if (fs.existsSync(savedHead)) fs.renameSync(savedHead, head);
				else fs.writeFileSync(head, originalHead, { mode: 0o600 });
				fs.rmSync(join(run.recordDir, `.${id}.head.tmp`), { force: true });
				await run.cleanup();
			}
		},
		30_000,
	);

	it("retains unindexed and sidecar-only records instead of guessing their owner", async () => {
		const run = await settledNativeVerifier(binary!);
		try {
			const orphan = `${"a".repeat(32)}.jsonl`;
			const sidecar = `${"b".repeat(32)}.head`;
			fs.writeFileSync(join(run.recordDir, orphan), "unknown", { mode: 0o600 });
			fs.writeFileSync(join(run.recordDir, sidecar), "12\n", { mode: 0o600 });
			const report = collectVerifiedRuns(run.stateRoot, { olderThanMs: 0, execute: true });
			expect(report.nativeRecords.filter((entry) => entry.runId === null)).toEqual([
				expect.objectContaining({ action: "kept", reason: "unreferenced", paths: [`native-exec/${orphan}`] }),
				expect.objectContaining({ action: "kept", reason: "unreferenced", paths: [`native-exec/${sidecar}`] }),
			]);
			expect(fs.readFileSync(join(run.recordDir, orphan), "utf8")).toBe("unknown");
		} finally {
			await run.cleanup();
		}
	}, 30_000);

	it("preserves records when authority compaction removed their grant provenance", async () => {
		const run = await settledNativeVerifier(binary!);
		try {
			const authority = openRunAuthority(run.runPath);
			try {
				expect(authority.store.compact(Date.now()).dropped).toBeGreaterThan(0);
			} finally {
				authority.store.release();
			}
			const report = collectVerifiedRuns(run.stateRoot, { olderThanMs: 0, execute: true });
			expect(
				report.nativeRecords.every((entry) => entry.action === "kept" && entry.reason === "native_authority"),
			).toBe(true);
			expect(fs.existsSync(join(run.runPath, "candidate"))).toBe(true);
		} finally {
			await run.cleanup();
		}
	}, 30_000);

	it("keeps future-dated native files instead of treating a wall-clock rollback as elapsed retention", async () => {
		const run = await settledNativeVerifier(binary!);
		try {
			const id = nativeRequestId(run.executionId);
			const path = join(run.recordDir, `${id}.jsonl`);
			const future = new Date("2100-01-01T00:00:00.000Z");
			fs.utimesSync(path, future, future);
			const report = collectVerifiedRuns(run.stateRoot, { olderThanMs: 0, execute: true });
			expect(report.nativeRecords).toContainEqual(
				expect.objectContaining({ requestId: id, action: "kept", reason: "recent" }),
			);
			expect(fs.existsSync(path)).toBe(true);
		} finally {
			await run.cleanup();
		}
	}, 30_000);

	it("fails closed on a damaged authority head without repairing or advancing it", async () => {
		const run = await settledNativeVerifier(binary!);
		const path = `${run.coordinator.inspectAuthority().path}.head`;
		const original = fs.readFileSync(path);
		try {
			fs.writeFileSync(path, "{}");
			const before = fs.readdirSync(run.recordDir).sort();
			const report = collectVerifiedRuns(run.stateRoot, { olderThanMs: 0, execute: true });
			expect(report.nativeRecords.every((entry) => entry.action === "kept")).toBe(true);
			expect(fs.readdirSync(run.recordDir).sort()).toEqual(before);
			expect(fs.readFileSync(path, "utf8")).toBe("{}");
			expect(fs.existsSync(join(run.runPath, "candidate"))).toBe(true);
		} finally {
			fs.writeFileSync(path, original);
			await run.cleanup();
		}
	}, 30_000);

	it("does not delete anything for a damaged run journal", async () => {
		const run = await settledNativeVerifier(binary!);
		const path = journalPath(run.runPath);
		const original = fs.readFileSync(path);
		try {
			fs.appendFileSync(path, "{}\n");
			const before = fs.readdirSync(run.recordDir).sort();
			const report = collectVerifiedRuns(run.stateRoot, { olderThanMs: 0, execute: true });
			expect(report.runs).toContainEqual(expect.objectContaining({ action: "kept", reason: "integrity" }));
			expect(fs.readdirSync(run.recordDir).sort()).toEqual(before);
		} finally {
			fs.writeFileSync(path, original);
			await run.cleanup();
		}
	}, 30_000);
});
