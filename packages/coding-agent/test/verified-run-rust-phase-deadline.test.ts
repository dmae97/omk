import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeNamespace } from "../src/core/verified-run/namespace-identity.ts";
import { readRunClock } from "../src/core/verified-run/recovery-clock.ts";
import { readRustExecutionRecord } from "../src/core/verified-run/rust-host-record.ts";
import { nativeWriter, waitUntil } from "./helpers/native-reconnect.ts";

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
const id = "a".repeat(32);
let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "native-phase-deadline-"));
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

function launch(deadlineMs: number, bootId = readRunClock().bootId) {
	const workspace = join(root, "workspace");
	const dir = join(root, "records");
	mkdirSync(workspace);
	mkdirSync(dir, { mode: 0o700 });
	const child = spawn(binary!, [], { env: {}, stdio: ["pipe", "pipe", "pipe"] });
	const closed = once(child, "close");
	let output = "";
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (bytes: string) => {
		output += bytes;
	});
	child.stderr.resume();
	child.stdin.on("error", () => {});
	const phaseDeadline = { bootId, deadlineMs };
	child.stdin.write(
		`${JSON.stringify({
			version: 1,
			requestId: id,
			workspace,
			argv: ["/bin/sh", "-c", "touch started; sleep 10; touch escaped"],
			writable: true,
			timeoutMs: 20_000,
			cleanupMs: 2000,
			maxOutputBytes: 4096,
			recordDir: dir,
			detachable: true,
			bindingDigest: "b".repeat(64),
			phaseDeadline,
		})}\n`,
	);
	return {
		child,
		closed,
		workspace,
		dir,
		phaseDeadline,
		output: () => output,
		record: () => readRustExecutionRecord(dir, id, 4096),
		cleanup: async () => {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			await closed;
		},
	};
}

describe.skipIf(!binary || process.platform !== "linux")("Rust-owned original phase deadline", () => {
	it("enforces the original boot deadline after parent loss, without any cancel or replacement observer", async () => {
		const run = launch(readRunClock().nowMs + 1500);
		try {
			await waitUntil(() => {
				if (run.child.exitCode !== null) throw new Error(`host exited: ${run.output()}`);
				return run.output().includes('"type":"ready"');
			});
			run.child.stdin.write(`${JSON.stringify({ type: "commit", requestId: id })}\n`);
			await waitUntil(() => existsSync(join(run.workspace, "started")));
			run.child.stdin.end();
			run.child.stdout.destroy();
			await run.closed;
			expect(run.record()).toMatchObject({
				phaseDeadline: run.phaseDeadline,
				detached: true,
				terminal: { failure: "deadline" },
			});
			expect(existsSync(join(run.dir, `${id}.cancel`))).toBe(false);
			expect(existsSync(join(run.workspace, "escaped"))).toBe(false);
			const identity = run.record()?.identity;
			if (!identity) throw new Error("missing namespace");
			expect(probeNamespace(identity)).toBe("gone");
		} finally {
			await run.cleanup();
		}
	}, 15_000);

	it("does not release code when the original deadline expires while waiting for commit", async () => {
		const run = launch(readRunClock().nowMs + 400);
		try {
			await run.closed;
			expect(run.record()).toMatchObject({ committed: false, terminal: { failure: "deadline" } });
			expect(existsSync(join(run.workspace, "started"))).toBe(false);
		} finally {
			await run.cleanup();
		}
	}, 10_000);

	it.each(["expired", "wrong-boot"] as const)(
		"rejects %s before spawning a sandbox",
		async (kind) => {
			const clock = readRunClock();
			const run = launch(
				kind === "expired" ? clock.nowMs - 1 : clock.nowMs + 5000,
				kind === "wrong-boot" ? "00000000-0000-4000-8000-000000000000" : clock.bootId,
			);
			try {
				await run.closed;
				expect(run.output()).toContain(`"code":"${kind === "expired" ? "deadline" : "clock_changed"}"`);
				expect(run.output()).not.toContain('"type":"spawned"');
				expect(existsSync(join(run.dir, `${id}.jsonl`))).toBe(false);
				expect(existsSync(join(run.workspace, "started"))).toBe(false);
			} finally {
				await run.cleanup();
			}
		},
		10_000,
	);

	it("refuses a durable record whose original phase cap was extended", async () => {
		vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary!);
		vi.stubEnv("OMK_RUST_EXECUTION_RECONNECT", "1");
		const run = await nativeWriter(binary!);
		const headPath = run.recordPath.replace(/\.jsonl$/, ".head");
		let original: string | undefined;
		let head: string | undefined;
		try {
			await waitUntil(() => run.record()?.detached === true);
			original = readFileSync(run.recordPath, "utf8");
			head = readFileSync(headPath, "utf8");
			const rows = original
				.trimEnd()
				.split("\n")
				.map((line) => JSON.parse(line));
			rows[0].phaseDeadline.deadlineMs += 1000;
			const altered = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
			writeFileSync(run.recordPath, altered);
			writeFileSync(headPath, `${Buffer.byteLength(altered)}\n`);
			await expect(run.coordinator.reconnect(run.command, run.approval)).rejects.toThrow(/native_binding/);
			expect(run.coordinator.events("reconnect").some(({ event }) => event.kind === "reconnected")).toBe(false);
			expect(existsSync(run.recordPath.replace(/\.jsonl$/, ".cancel"))).toBe(false);
			expect(run.attempts()).toBe("x");
		} finally {
			if (original) writeFileSync(run.recordPath, original);
			if (head) writeFileSync(headPath, head);
			await run.cleanup();
		}
	}, 30_000);

	it("binds the production source-CLI writer record to its unchanged original phase cap", async () => {
		vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary!);
		vi.stubEnv("OMK_RUST_EXECUTION_RECONNECT", "1");
		const run = await nativeWriter(binary!);
		try {
			expect(run.record()).toMatchObject({
				phaseDeadline: {
					bootId: run.before.state.budget!.bootId,
					deadlineMs: run.before.state.budget!.workDeadlineMs,
				},
			});
			run.release();
			expect((await run.coordinator.reconnect(run.command, run.approval)).verification).toBe("verified");
			expect(readFileSync(join(run.runPath, "writer", "attempts"), "utf8")).toBe("x");
		} finally {
			await run.cleanup();
		}
	}, 30_000);
});
