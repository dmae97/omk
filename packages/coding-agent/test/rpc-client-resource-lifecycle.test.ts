import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.ts";

const tempDirs: string[] = [];
const clients: RpcClient[] = [];

function createClient(contents: string): RpcClient {
	const dir = mkdtempSync(join(tmpdir(), "omk-rpc-client-lifecycle-"));
	tempDirs.push(dir);
	const path = join(dir, "child.mjs");
	writeFileSync(path, contents);
	const client = new RpcClient({ cliPath: path });
	clients.push(client);
	return client;
}

const respondingChild = `
process.stdin.setEncoding("utf8");
process.stdin.on("data", (input) => {
 const command = JSON.parse(input.trim());
 process.stdout.write(JSON.stringify({type:"response", id:command.id, command:command.type, success:true, data:{commands:[]}}) + "\\n");
});
`;

function listenerCount(client: RpcClient): number {
	return (client as unknown as { eventListeners: unknown[] }).eventListeners.length;
}

async function observedWithin(promise: Promise<unknown>, deadline = 100): Promise<unknown> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(
				() => "resolved",
				(error: unknown) => (error instanceof Error ? error.message : String(error)),
			),
			new Promise<string>((resolve) => {
				timeout = setTimeout(() => resolve("still pending"), deadline);
			}),
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}

afterEach(async () => {
	for (const client of clients.splice(0)) await client.stop();
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("RpcClient resource lifecycle", () => {
	test("retains only a bounded stderr tail, and resets it on restart", async () => {
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const client = createClient(`
process.stdin.once("data", () => {
 process.stderr.write("x".repeat(32 * 1024) + "END-OF-STDERR", () => {
  process.stdout.write(JSON.stringify({type:"response", id:"req_1", command:"get_commands", success:true, data:{commands:[]}}) + "\\n");
 });
});
process.stdin.resume();
`);
		await client.start();
		await client.getCommands();
		await vi.waitFor(() => expect(client.getStderr()).toContain("END-OF-STDERR"));
		expect(client.getStderr()).toHaveLength(8192);
		expect(client.getStderr().endsWith("END-OF-STDERR")).toBe(true);
		await client.stop();
		await client.start();
		expect(client.getStderr()).toBe("");
	});

	test("rejects event waiters and releases listeners when the child closes", async () => {
		const client = createClient(`process.stdin.once("data", () => process.exit(43)); process.stdin.resume();`);
		await client.start();
		const idle = client.waitForIdle(500);
		const events = client.collectEvents(500);
		const idleOutcome = observedWithin(idle);
		const eventsOutcome = observedWithin(events);
		await expect(client.getCommands()).rejects.toThrow(/Agent process exited/);
		expect(await idleOutcome).toMatch(/Agent process exited/);
		expect(await eventsOutcome).toMatch(/Agent process exited/);
		expect(listenerCount(client)).toBe(0);
	});

	test("rejects current and later event waiters on stop", async () => {
		const client = createClient(respondingChild);
		await client.start();
		const idleOutcome = observedWithin(client.waitForIdle(500));
		const eventsOutcome = observedWithin(client.collectEvents(500));
		await client.stop();
		expect(await idleOutcome).toMatch(/stopped/);
		expect(await eventsOutcome).toMatch(/stopped/);
		expect(listenerCount(client)).toBe(0);
		await expect(client.waitForIdle()).rejects.toThrow(/stopped/);
		await expect(client.collectEvents()).rejects.toThrow(/stopped/);
	});

	test("cancels the collector when prompt acceptance fails", async () => {
		const client = createClient(`
process.stdin.once("data", (input) => {
 const command = JSON.parse(input.toString().trim());
 process.stdout.write(JSON.stringify({type:"response", id:command.id, command:command.type, success:false, error:"prompt refused"}) + "\\n");
});
process.stdin.resume();
`);
		await client.start();
		await expect(client.promptAndWait("rejected", undefined, 500)).rejects.toThrow("prompt refused");
		expect(listenerCount(client)).toBe(0);
	});

	test("does not retain exit listeners or wait one second for an exited child", async () => {
		const client = createClient(`process.stdin.once("data", () => process.exit(43)); process.stdin.resume();`);
		await client.start();
		await expect(client.getCommands()).rejects.toThrow(/Agent process exited/);
		const started = performance.now();
		await client.stop();
		expect(performance.now() - started).toBeLessThan(500);
	});

	test("settles concurrent event waiters without skipping a listener during unsubscribe", async () => {
		const client = createClient(
			respondingChild.replace(
				"const command = JSON.parse(input.trim());",
				'const command = JSON.parse(input.trim()); process.stdout.write(JSON.stringify({type:"agent_end", messages:[]}) + "\\n");',
			),
		);
		await client.start();
		const idle = client.waitForIdle(500);
		const events = client.collectEvents(500);
		const request = client.getCommands();
		await expect(idle).resolves.toBeUndefined();
		await expect(events).resolves.toEqual([{ type: "agent_end", messages: [] }]);
		await request;
		expect(listenerCount(client)).toBe(0);
	});

	test("bounds post-exit drain when a descendant holds inherited output pipes", async () => {
		const client = createClient(`
import { spawn } from "node:child_process";
process.stdin.once("data", () => {
 const descendant = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1200)"], {stdio:["ignore", "inherit", "inherit"]});
 descendant.unref();
 process.exit(43);
});
process.stdin.resume();
`);
		await client.start();
		const child = (client as unknown as { process: ChildProcess }).process;
		const idleOutcome = observedWithin(client.waitForIdle(1000), 350);
		const requestOutcome = observedWithin(client.getCommands(), 350);
		await new Promise<void>((resolve) => child.once("exit", () => resolve()));
		expect(child.exitCode).toBe(43);
		expect(await idleOutcome).toMatch(/Agent process exited/);
		expect(await requestOutcome).toMatch(/Agent process exited/);
		expect(listenerCount(client)).toBe(0);
	});

	for (const failure of ["false", "throw"] as const) {
		test(`rejects termination uncertainty and retains ownership when kill returns ${failure}`, async () => {
			const client = createClient(respondingChild);
			await client.start();
			const child = (client as unknown as { process: ChildProcess }).process;
			const kill = vi.spyOn(child, "kill").mockImplementationOnce(() => {
				if (failure === "throw") throw new Error("simulated signalling failure");
				return false;
			});
			try {
				expect(await observedWithin(client.stop(), 250)).toMatch(/termination uncertain/);
				expect((client as unknown as { process: ChildProcess }).process).toBe(child);
				expect(child.exitCode).toBeNull();
			} finally {
				kill.mockRestore();
				await client.stop();
			}
		});
	}

	for (const failure of ["false", "throw"] as const) {
		test(`settles uncertain SIGKILL ${failure} at the escalation deadline without retaining the timer`, async () => {
			const client = createClient(
				`process.on("SIGTERM", () => {}); process.stdin.resume(); setInterval(() => {}, 1000);`,
			);
			await client.start();
			const child = (client as unknown as { process: ChildProcess }).process;
			const originalKill = child.kill.bind(child);
			const kill = vi.spyOn(child, "kill").mockImplementation((signal) => {
				if (signal !== "SIGKILL") return originalKill(signal);
				if (failure === "throw") throw new Error("simulated escalation failure");
				return false;
			});
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
			try {
				const outcome = client.stop().then(
					() => ({ error: undefined }),
					(error: unknown) => ({ error }),
				);
				await vi.advanceTimersByTimeAsync(1000);
				const { error } = await outcome;
				expect(error).toMatchObject({ name: "RpcTerminationUncertainError", code: "rpc.termination_uncertain" });
				expect(vi.getTimerCount()).toBe(0);
				expect((client as unknown as { process: ChildProcess }).process).toBe(child);
			} finally {
				vi.useRealTimers();
				kill.mockRestore();
				child.kill("SIGKILL");
				if (child.exitCode === null && child.signalCode === null) {
					await new Promise<void>((resolve) => child.once("exit", () => resolve()));
				}
				await client.stop();
			}
		});
	}

	test("preserves final events drained after direct process exit", async () => {
		const client = createClient(`
process.stdin.once("data", () => {
 process.stdout.write(JSON.stringify({type:"agent_end", messages:[]}) + "\\n", () => process.exit(0));
});
process.stdin.resume();
`);
		await client.start();
		const events = client.collectEvents(1000);
		const request = client.getCommands().catch(() => {});
		await expect(events).resolves.toEqual([{ type: "agent_end", messages: [] }]);
		await request;
		expect(listenerCount(client)).toBe(0);
	});
});
