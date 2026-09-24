import { describe, expect, it, vi } from "vitest";
import type { McpClient, McpClientOptions } from "../../src/core/mcp/client.ts";
import { McpManager } from "../../src/core/mcp/manager.ts";

function gate() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const flush = async () => {
	for (let i = 0; i < 15; i++) await Promise.resolve();
};
function fixture(names: string[], connectionConcurrency?: number) {
	const attempts: {
		name: string;
		connect: ReturnType<typeof gate>;
		list: ReturnType<typeof gate>;
		close: ReturnType<typeof vi.fn>;
	}[] = [];
	const createClient = (options: McpClientOptions) => {
		const attempt = { name: options.name, connect: gate(), list: gate(), close: vi.fn() };
		attempts.push(attempt);
		return {
			connect: () => attempt.connect.promise,
			listTools: async () => {
				await attempt.list.promise;
				return [{ name: "echo", description: `${options.name} tool`, inputSchema: { type: "object" } }];
			},
			close: attempt.close,
			ping: async () => {},
			serverInfo: { name: "fixture", version: "1" },
		} as unknown as McpClient;
	};
	const manager = new McpManager({
		servers: names.map((name) => ({ name, command: "fixture" })),
		connectionConcurrency,
		createClient,
	});
	return {
		manager,
		attempts,
		finish: (index: number) => {
			attempts[index].connect.resolve();
			attempts[index].list.resolve();
		},
	};
}

describe("MCP bounded connection startup", () => {
	it("defaults to four starts without reducing the final inventory", async () => {
		const { manager, attempts, finish } = fixture(Array.from({ length: 9 }, (_, i) => `s${i}`));
		const pending = manager.listToolDefinitions();
		expect(attempts).toHaveLength(4);
		expect(manager.status().filter((entry) => entry.state === "queued")).toHaveLength(5);
		for (let i = 0; i < 9; i++) {
			finish(i);
			await flush();
		}
		expect((await pending).map((tool) => tool.name)).toEqual(Array.from({ length: 9 }, (_, i) => `s${i}__echo`));
		manager.close();
	});

	it("shares capacity and single-flight across concurrent listings and direct connect", async () => {
		const { manager, attempts, finish } = fixture(["a", "b", "c"], 1);
		const first = manager.listToolDefinitions();
		const second = manager.listToolDefinitions();
		const direct = manager.connect("c");
		expect(attempts.map((attempt) => attempt.name)).toEqual(["a"]);
		for (let i = 0; i < 3; i++) {
			finish(i);
			await flush();
		}
		expect(await second).toEqual(await first);
		expect((await direct).state).toBe("ready");
		expect(attempts.map((attempt) => attempt.name)).toEqual(["a", "b", "c"]);
		manager.close();
	});

	it("holds the slot through tools/list and preserves configuration order after out-of-order completion", async () => {
		const { manager, attempts, finish } = fixture(["a", "b", "c"], 2);
		const pending = manager.listToolDefinitions();
		attempts[0].connect.resolve();
		await flush();
		expect(attempts).toHaveLength(2);
		finish(1);
		await flush();
		expect(attempts.map((entry) => entry.name)).toEqual(["a", "b", "c"]);
		finish(2);
		finish(0);
		expect((await pending).map((tool) => tool.name)).toEqual(["a__echo", "b__echo", "c__echo"]);
		manager.close();
	});

	it("cancels queued starts on close and ignores late list completion", async () => {
		const { manager, attempts, finish } = fixture(["a", "b", "c"], 1);
		const pending = manager.listToolDefinitions();
		attempts[0].connect.resolve();
		await flush();
		manager.close();
		expect(attempts[0].close).toHaveBeenCalled();
		finish(0);
		expect(await pending).toEqual([]);
		expect(attempts.map((entry) => entry.name)).toEqual(["a"]);
		expect(manager.status().map((entry) => entry.state)).toEqual(["idle", "idle", "idle"]);
	});

	it("does not release an active slot until the old attempt settles after close", async () => {
		const { manager, attempts, finish } = fixture(["a"], 1);
		const first = manager.connect("a");
		manager.close();
		const next = manager.connect("a");
		expect(attempts).toHaveLength(1);
		finish(0);
		await flush();
		expect(attempts).toHaveLength(2);
		finish(1);
		await first;
		expect((await next).state).toBe("ready");
		manager.close();
	});

	it("releases failed starts, lets healthy peers finish, and retries only on explicit health recovery", async () => {
		const { manager, attempts, finish } = fixture(["a", "b"], 1);
		const pending = manager.listToolDefinitions();
		attempts[0].connect.reject(new Error("handshake failed"));
		await flush();
		finish(1);
		expect((await pending).map((tool) => tool.name)).toEqual(["b__echo"]);
		await manager.checkHealth();
		expect(attempts).toHaveLength(2);
		const recovery = manager.checkHealth({ reconnectFailed: true });
		expect(attempts).toHaveLength(3);
		finish(2);
		expect((await recovery).map((entry) => entry.state)).toEqual(["ready", "ready"]);
		manager.close();
	});

	it("isolates client construction failures without wedging the queue", async () => {
		const manager = new McpManager({
			servers: [
				{ name: "broken", command: "fixture" },
				{ name: "disabled", command: "fixture", disabled: true },
			],
			connectionConcurrency: 1,
			createClient: () => {
				throw new Error("factory failed");
			},
		});
		expect(await manager.listToolDefinitions()).toEqual([]);
		expect(manager.status()).toEqual([
			expect.objectContaining({ name: "broken", state: "failed", error: "mcp.connect_failed (Error)" }),
			expect.objectContaining({ name: "disabled", state: "failed", error: "disabled by configuration" }),
		]);
	});

	it.each([undefined, false, true])(
		"forwards the optional inheritEnv=%s policy to the transport",
		async (inheritEnv) => {
			let received: McpClientOptions["transport"] | undefined;
			const manager = new McpManager({
				servers: [{ name: "fixture", command: "fake", ...(inheritEnv === undefined ? {} : { inheritEnv }) }],
				createClient(options) {
					received = options.transport;
					return {
						connect: async () => {},
						listTools: async () => [],
						close: () => {},
						serverInfo: {},
					} as unknown as McpClient;
				},
			});
			try {
				await manager.connect("fixture");
				expect(received?.inheritEnv).toBe(inheritEnv);
			} finally {
				manager.close();
			}
		},
	);

	it.each([0, -1, 1.5, NaN, Infinity])("rejects invalid concurrency %s", (connectionConcurrency) => {
		expect(() => new McpManager({ servers: [], connectionConcurrency })).toThrow(RangeError);
	});
});
