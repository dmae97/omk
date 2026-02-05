import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as gatewayCoordinator from "@oh-my-pi/pi-coding-agent/ipy/gateway-coordinator";
import { PythonKernel } from "@oh-my-pi/pi-coding-agent/ipy/kernel";
import { TempDir } from "@oh-my-pi/pi-utils";
import type { Subprocess } from "bun";

type SpawnOptions = Parameters<typeof Bun.spawn>[1];

type FetchCall = { url: string; init?: RequestInit };

type FetchResponse = {
	ok: boolean;
	status: number;
	json: () => Promise<unknown>;
	text: () => Promise<string>;
};

type MockEnvironment = {
	fetchCalls: FetchCall[];
	spawnCalls: { cmd: string[]; options: SpawnOptions }[];
};

type MessageEventPayload = { data: ArrayBuffer };

type WebSocketHandler = (event: unknown) => void;

type WebSocketMessageHandler = (event: MessageEventPayload) => void;

class FakeWebSocket {
	static OPEN = 1;
	static CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readyState = FakeWebSocket.OPEN;
	binaryType = "arraybuffer";
	url: string;
	sent: ArrayBuffer[] = [];

	onopen: WebSocketHandler | null = null;
	onerror: WebSocketHandler | null = null;
	onclose: WebSocketHandler | null = null;
	onmessage: WebSocketMessageHandler | null = null;

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.onopen?.(undefined);
		});
	}

	send(data: ArrayBuffer): void {
		this.sent.push(data);
	}

	close(): void {
		this.readyState = FakeWebSocket.CLOSED;
		this.onclose?.(undefined);
	}
}

const createResponse = (options: { ok: boolean; status?: number; json?: unknown; text?: string }): FetchResponse => {
	return {
		ok: options.ok,
		status: options.status ?? (options.ok ? 200 : 500),
		json: async () => options.json ?? {},
		text: async () => options.text ?? "",
	};
};

const createFakeProcess = (): Subprocess => {
	const exited = new Promise<number>(() => undefined);
	return { pid: 999999, exited } as Subprocess;
};

describe("PythonKernel gateway lifecycle", () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalSpawn = Bun.spawn;
	const originalSleep = Bun.sleep;
	const originalWhich = Bun.which;
	const originalExecute = PythonKernel.prototype.execute;
	const originalGatewayUrl = Bun.env.PI_PYTHON_GATEWAY_URL;
	const originalGatewayToken = Bun.env.PI_PYTHON_GATEWAY_TOKEN;
	const originalBunEnv = Bun.env.BUN_ENV;

	let tempDir: TempDir;
	let env: MockEnvironment;

	beforeEach(() => {
		tempDir = TempDir.createSync("@omp-python-kernel-");
		env = { fetchCalls: [], spawnCalls: [] };

		Bun.env.BUN_ENV = "test";
		delete Bun.env.PI_PYTHON_GATEWAY_URL;
		delete Bun.env.PI_PYTHON_GATEWAY_TOKEN;

		FakeWebSocket.instances = [];
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		Bun.spawn = ((cmd: string[] | string, options?: SpawnOptions) => {
			const normalized = Array.isArray(cmd) ? cmd : [cmd];
			env.spawnCalls.push({ cmd: normalized, options: options ?? {} });
			return createFakeProcess();
		}) as typeof Bun.spawn;

		Bun.sleep = (async () => undefined) as typeof Bun.sleep;

		Bun.which = (() => "/usr/bin/python") as typeof Bun.which;

		Object.defineProperty(PythonKernel.prototype, "execute", {
			value: (async () => ({
				status: "ok",
				cancelled: false,
				timedOut: false,
				stdinRequested: false,
			})) as typeof PythonKernel.prototype.execute,
			configurable: true,
		});
	});

	afterEach(() => {
		if (tempDir) {
			tempDir.removeSync();
		}

		if (originalBunEnv === undefined) {
			delete Bun.env.BUN_ENV;
		} else {
			Bun.env.BUN_ENV = originalBunEnv;
		}
		if (originalGatewayUrl === undefined) {
			delete Bun.env.PI_PYTHON_GATEWAY_URL;
		} else {
			Bun.env.PI_PYTHON_GATEWAY_URL = originalGatewayUrl;
		}
		if (originalGatewayToken === undefined) {
			delete Bun.env.PI_PYTHON_GATEWAY_TOKEN;
		} else {
			Bun.env.PI_PYTHON_GATEWAY_TOKEN = originalGatewayToken;
		}

		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;

		Bun.spawn = originalSpawn;
		Bun.sleep = originalSleep;
		Bun.which = originalWhich;
		Object.defineProperty(PythonKernel.prototype, "execute", { value: originalExecute, configurable: true });
	});

	it("starts shared gateway, interrupts, and shuts down", async () => {
		vi.spyOn(gatewayCoordinator, "acquireSharedGateway").mockResolvedValue({
			url: "http://127.0.0.1:9999",
			isShared: true,
		});

		globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
			const url = String(input);
			env.fetchCalls.push({ url, init });

			if (url.endsWith("/api/kernels") && init?.method === "POST") {
				return createResponse({ ok: true, json: { id: "kernel-123" } }) as unknown as Response;
			}

			return createResponse({ ok: true }) as unknown as Response;
		}) as typeof fetch;

		const kernel = await PythonKernel.start({ cwd: tempDir.path() });

		expect(env.fetchCalls.some(call => call.url.endsWith("/api/kernels") && call.init?.method === "POST")).toBe(true);

		await kernel.interrupt();
		expect(env.fetchCalls.some(call => call.url.includes("/interrupt") && call.init?.method === "POST")).toBe(true);

		await kernel.shutdown();
		expect(env.fetchCalls.some(call => call.init?.method === "DELETE")).toBe(true);
		expect(kernel.isAlive()).toBe(false);
	});

	it("throws when shared gateway kernel creation never succeeds", async () => {
		vi.spyOn(gatewayCoordinator, "acquireSharedGateway").mockResolvedValue({
			url: "http://127.0.0.1:9999",
			isShared: true,
		});

		globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
			const url = String(input);
			env.fetchCalls.push({ url, init });
			if (url.endsWith("/api/kernels") && init?.method === "POST") {
				return createResponse({ ok: false, status: 503, text: "oops" }) as unknown as Response;
			}
			return createResponse({ ok: true }) as unknown as Response;
		}) as typeof fetch;

		await expect(PythonKernel.start({ cwd: tempDir.path() })).rejects.toThrow(
			"Failed to create kernel on shared gateway",
		);
	});

	it("does not throw when shutdown API fails", async () => {
		vi.spyOn(gatewayCoordinator, "acquireSharedGateway").mockResolvedValue({
			url: "http://127.0.0.1:9999",
			isShared: true,
		});

		globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
			const url = String(input);
			env.fetchCalls.push({ url, init });
			if (url.endsWith("/api/kernels") && init?.method === "POST") {
				return createResponse({ ok: true, json: { id: "kernel-456" } }) as unknown as Response;
			}
			if (init?.method === "DELETE") {
				throw new Error("delete failed");
			}
			return createResponse({ ok: true }) as unknown as Response;
		}) as typeof fetch;

		const kernel = await PythonKernel.start({ cwd: tempDir.path() });

		await expect(kernel.shutdown()).resolves.toBeUndefined();
	});
});
