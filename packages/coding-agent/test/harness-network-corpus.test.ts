import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeSandbox } from "../src/core/verified-run/broker.ts";
import { liveSandboxGroupCount } from "../src/core/verified-run/sandbox-groups.ts";

let workspace: string;
beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "harness-network-"));
	writeFileSync(join(workspace, "input.txt"), "synthetic input\n");
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));
const request = () => ({ workspace, writable: false, timeoutMs: 5000, cleanupMs: 15000, maxOutputBytes: 4096 });

describe("harness network corpus", () => {
	it("rejects access to a live host loopback service without delivering bytes", async () => {
		let connections = 0;
		let received = 0;
		const server = createServer((socket) => {
			connections++;
			socket.on("data", (bytes: Buffer) => {
				received += bytes.length;
			});
			socket.end();
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("missing loopback listener");
			// Prove the fake service is reachable from its own host before testing isolation.
			const control = createConnection({ host: "127.0.0.1", port: address.port });
			control.setTimeout(2000, () => control.destroy(new Error("loopback control timed out")));
			try {
				await once(control, "close");
			} finally {
				control.destroy();
			}
			expect(connections).toBe(1);
			expect(received).toBe(0);
			const groups = liveSandboxGroupCount();
			const script = [
				"import errno, socket",
				"s = socket.socket()",
				"s.settimeout(2)",
				"try:",
				`    s.connect(('127.0.0.1', ${address.port}))`,
				"except OSError as error:",
				"    assert error.errno in (errno.ECONNREFUSED, errno.ENETUNREACH), repr(error)",
				"    print('isolated')",
				"else:",
				"    s.sendall(b'synthetic-probe')",
				"    raise AssertionError('host network reached')",
				"finally:",
				"    s.close()",
			].join("\n");
			const result = await executeSandbox({
				...request(),
				argv: ["/usr/bin/python3", "-I", "-c", script],
				onReady: () => {},
			});
			expect(result.failure).toBeNull();
			expect(result.exitCode).toBe(0);
			expect(result.stdout.toString()).toBe("isolated\n");
			expect(connections).toBe(1);
			expect(received).toBe(0);
			expect(liveSandboxGroupCount()).toBe(groups);
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	});

	it("permits an approved local read in the same network-isolated boundary", async () => {
		const groups = liveSandboxGroupCount();
		const result = await executeSandbox({ ...request(), argv: ["/bin/cat", "input.txt"], onReady: () => {} });
		expect(result.failure).toBeNull();
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toBe("synthetic input\n");
		expect(liveSandboxGroupCount()).toBe(groups);
	});
});
