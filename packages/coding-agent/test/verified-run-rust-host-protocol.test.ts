import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import { parseRustHostEvent } from "../src/core/verified-run/rust-host-protocol.ts";

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
const requestId = "a".repeat(32);

it("rejects malformed, wrong-owner, oversized and unknown native reply shapes", () => {
	const parse = (value: unknown) => parseRustHostEvent(JSON.stringify(value), requestId);
	for (const value of [
		null,
		[],
		{ type: "spawned", requestId: "wrong", pid: 10 },
		{ type: "spawned", requestId, pid: 0 },
		{ type: "spawned", requestId, pid: 10, extra: true },
		{ type: "ready", requestId, info: [] },
		{ type: "output", requestId, channel: "stdout", data: [256] },
		{ type: "output", requestId, channel: "stdout", data: Array(4097).fill(0) },
		{ type: "finished", requestId, exitCode: 0, failure: null, durationMs: -1 },
		{ type: "invented", requestId },
	])
		expect(() => parse(value)).toThrow(/native_host_protocol/);
	expect(parse({ type: "output", requestId, channel: "stderr", data: [0, 255] })).toEqual({
		type: "output",
		channel: "stderr",
		data: Buffer.from([0, 255]),
	});
});

async function withHost(
	run: (api: {
		send: (value: unknown) => void;
		event: () => Promise<ReturnType<typeof parseRustHostEvent>>;
		disconnect: () => void;
		workspace: string;
		closed: Promise<number | null>;
		exited: Promise<number | null>;
		pause: () => void;
	}) => Promise<void>,
	overrides: { argv?: string[]; timeoutMs?: number; maxOutputBytes?: number } = {},
) {
	if (!binary) throw new Error("explicit host binary required");
	const root = mkdtempSync(join(tmpdir(), "rust-wire-"));
	const workspace = join(root, "project");
	mkdirSync(workspace);
	const child = spawn(binary, [], { env: {}, stdio: ["pipe", "pipe", "pipe"] });
	child.stderr.resume();
	const lines = createInterface({ input: child.stdout });
	let linesClosed = false;
	lines.once("close", () => {
		linesClosed = true;
	});
	const iterator = lines[Symbol.asyncIterator]();
	const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
	const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
	const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
	const event = async () => {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			const row = await Promise.race([
				iterator.next(),
				new Promise<never>((_, reject) => {
					timeout = setTimeout(() => reject(new Error("host event deadline")), 10000);
				}),
			]);
			if (row.done) throw new Error("native stream closed");
			return parseRustHostEvent(row.value, requestId);
		} finally {
			clearTimeout(timeout);
		}
	};
	try {
		send({
			version: 1,
			requestId,
			workspace,
			argv: ["/bin/sh", "-c", "sleep 1; touch escaped; sleep 20"],
			writable: true,
			timeoutMs: 5000,
			cleanupMs: 3000,
			maxOutputBytes: 1024,
			...overrides,
		});
		await run({
			send,
			event,
			disconnect: () => child.stdin.end(),
			workspace,
			closed,
			exited,
			pause: () => lines.pause(),
		});
	} finally {
		if (!linesClosed) lines.resume();
		child.stdout.resume();
		child.stdin.end();
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			closed,
			new Promise<void>((resolve) => {
				timer = setTimeout(() => {
					child.kill("SIGKILL");
					resolve();
				}, 6000);
			}),
		]);
		clearTimeout(timer);
		lines.close();
		rmSync(root, { recursive: true, force: true });
	}
}

describe.skipIf(!binary)("native control lifecycle", () => {
	it("does not let a non-reading parent block native cancellation", async () => {
		await withHost(
			async ({ event, send, pause, exited }) => {
				expect((await event()).type).toBe("spawned");
				expect((await event()).type).toBe("ready");
				pause();
				send({ type: "commit", requestId });
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					const result = await Promise.race([
						exited,
						new Promise<never>((_, reject) => {
							timer = setTimeout(() => reject(new Error("native blocked on parent output")), 2000);
						}),
					]);
					expect(result).not.toBeNull();
				} finally {
					clearTimeout(timer);
				}
			},
			{ argv: ["/bin/sh", "-c", "head -c 1048576 /dev/zero; sleep 20"], timeoutMs: 500, maxOutputBytes: 16777216 },
		);
	}, 15000);
	it.each(["before", "after"])(
		"settles a parent disconnect %s commit without detached work",
		async (when) => {
			await withHost(async ({ event, send, disconnect, workspace, closed }) => {
				expect((await event()).type).toBe("spawned");
				expect((await event()).type).toBe("ready");
				if (when === "after") send({ type: "commit", requestId });
				disconnect();
				let result = await event();
				while (result.type === "output") result = await event();
				expect(result).toMatchObject({ type: "finished", failure: "cancelled" });
				expect(await closed).toBe(0);
				await new Promise((resolve) => setTimeout(resolve, 1100));
				expect(existsSync(join(workspace, "escaped"))).toBe(false);
			});
		},
		20000,
	);

	it("rejects a control message for a different execution before releasing code", async () => {
		await withHost(async ({ event, send, workspace, closed }) => {
			expect((await event()).type).toBe("spawned");
			expect((await event()).type).toBe("ready");
			send({ type: "commit", requestId: "b".repeat(32) });
			expect(await event()).toMatchObject({ type: "finished", failure: "protocol" });
			expect(await closed).toBe(0);
			expect(existsSync(join(workspace, "escaped"))).toBe(false);
		});
	});
});
