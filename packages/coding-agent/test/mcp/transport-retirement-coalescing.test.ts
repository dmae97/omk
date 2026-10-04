import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { retireMcpClient } from "../../src/core/mcp/transport-retirement.ts";
import { phase3Gate } from "../fixtures/phase3-gate.ts";

function client() {
	const physical = phase3Gate<void>();
	return { physical, close: vi.fn(), waitForTransportClose: () => physical.promise };
}
const owner = (): { retiring?: Promise<void>; error?: string } => ({});

it("coalesces duplicate requests within an owner epoch", async () => {
	const state = owner();
	const transport = client();
	const promises = new Set<Promise<void>>();
	for (let i = 0; i < 1000; i++) promises.add(retireMcpClient(state, transport));
	expect(transport.close).toHaveBeenCalledOnce();
	const count = promises.size;
	transport.physical.resolve();
	await Promise.all(promises);
	expect(state.retiring).toBeUndefined();
	expect(count).toBe(1);
});

it("preserves snapshot waits for distinct clients and ignores stale cleanup", async () => {
	const state = owner();
	const a = client();
	const b = client();
	const c = client();
	const first = retireMcpClient(state, a);
	const second = retireMcpClient(state, b);
	expect(first).not.toBe(second);
	expect(retireMcpClient(state, a)).toBe(second);
	a.physical.resolve();
	await first;
	expect(state.retiring).toBe(second);
	const third = retireMcpClient(state, c);
	b.physical.resolve();
	await second;
	expect(state.retiring).toBe(third);
	c.physical.resolve();
	await third;
	expect(state.retiring).toBeUndefined();
	const next = retireMcpClient(state, a);
	await next;
	expect(state.retiring).toBeUndefined();
	expect(a.close).toHaveBeenCalledOnce();
});

it("shares one physical close across owners without merging their scopes", async () => {
	const left = owner();
	const right = owner();
	const a = client();
	const b = client();
	const leftClose = retireMcpClient(left, a);
	retireMcpClient(right, a);
	const rightClose = retireMcpClient(right, b);
	a.physical.resolve();
	await leftClose;
	expect(left.retiring).toBeUndefined();
	expect(right.retiring).toBe(rightClose);
	b.physical.resolve();
	await rightClose;
	expect(a.close).toHaveBeenCalledOnce();
});

it("publishes coalescing state before a reentrant client close", async () => {
	const state = owner();
	const transport = client();
	let reentrant: Promise<void> | undefined;
	transport.close.mockImplementation(() => {
		reentrant = retireMcpClient(state, transport);
	});
	const close = retireMcpClient(state, transport);
	transport.physical.resolve();
	await close;
	expect(reentrant).toBe(close);
	expect(transport.close).toHaveBeenCalledOnce();
});

it("retains unknown physical termination after an observation rejects", async () => {
	const state = owner();
	const transport = {
		close: vi.fn(),
		waitForTransportClose: async () => {
			throw new Error("unknown");
		},
	};
	const close = retireMcpClient(state, transport);
	let settled = false;
	void close.then(() => {
		settled = true;
	});
	await setImmediate();
	expect(state.error).toBe("mcp.transport_retirement_unconfirmed");
	expect(state.retiring).toBe(close);
	expect(retireMcpClient(state, transport)).toBe(close);
	expect(settled).toBe(false);
});

it("accepts late physical evidence after a close request throws", async () => {
	const state = owner();
	const transport = client();
	transport.close.mockImplementation(() => {
		throw new Error("stop failed");
	});
	const close = retireMcpClient(state, transport);
	expect(state.error).toBe("mcp.transport_retirement_unconfirmed");
	expect(state.retiring).toBe(close);
	transport.physical.resolve();
	await close;
	expect(state.retiring).toBeUndefined();
});
