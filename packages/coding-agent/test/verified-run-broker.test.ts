import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeSandbox } from "../src/core/verified-run/broker.ts";

let workspace: string;
beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "broker-"));
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));
const request = () => ({ workspace, writable: true, timeoutMs: 1500, cleanupMs: 1000, maxOutputBytes: 4096 });

describe("verified run owned process boundary", () => {
	it("joins a real timed-out namespace without cancelling a foreign process", async () => {
		const foreign = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
		const closed = once(foreign, "close");
		try {
			await once(foreign, "spawn");
			const result = await executeSandbox({
				...request(),
				argv: ["/bin/sh", "-c", "printf started; sleep 30"],
				onReady: () => {},
			});
			expect(result.stdout.toString()).toBe("started");
			expect(result.failure).toBe("deadline");
			expect(foreign.exitCode).toBeNull();
			expect(foreign.signalCode).toBeNull();
		} finally {
			foreign.kill("SIGKILL");
			await closed;
		}
	});

	it("reaps background descendants when the namespace command ends", async () => {
		const result = await executeSandbox({
			...request(),
			argv: ["/bin/sh", "-c", "sleep 30 >/dev/null 2>&1 & printf finished"],
			onReady: () => {},
		});
		expect(result.stdout.toString()).toBe("finished");
		expect(result.failure).toBeNull();
		expect(result.exitCode).toBe(0);
	});

	it("refuses an already cancelled request without starting a child", async () => {
		await expect(
			executeSandbox({ ...request(), argv: ["/bin/true"], signal: AbortSignal.abort(), onReady: () => {} }),
		).rejects.toThrow(/cancelled/);
	});

	it("refuses dispatch without an identity gate instead of degrading to best effort", async () => {
		await expect(executeSandbox({ ...request(), argv: ["/bin/true"] })).rejects.toThrow(/unsupported_boundary/);
	});
});
