import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentMessage } from "omk-agent-core";
import { getModel } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionMemory } from "../src/core/session-memory.ts";
import { VerifiedMemoryStore } from "../src/core/verified-memory-store.ts";

let root: string;
let agent: Agent;
const messages: AgentMessage[] = [{ role: "user", content: "alpha storage", timestamp: 1 }];
const options = () => ({ queryContext: "alpha storage", maxPromptTokens: 12000, tokenizerMode: "fallback" as const });
const controllers: SessionMemory[] = [];
function install() {
	const memory = new SessionMemory(agent, root, options, (_messages, window) => window);
	controllers.push(memory);
	return memory;
}
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-memory-lifecycle-"));
	writeFileSync(join(root, "facts.txt"), "alpha storage uses append-only events");
	const admitted = new VerifiedMemoryStore(root).remember({ path: "facts.txt", startLine: 1, endLine: 1 });
	if (admitted.verdict !== "accept") throw new Error("fixture admission");
	agent = new Agent({ initialState: { model: getModel("openai", "gpt-4o-mini") } });
	vi.stubEnv("OMK_VERIFIED_MEMORY", "1");
	vi.stubEnv("OMK_MEMORY_SELECTION", "v2");
});
afterEach(() => {
	for (const memory of controllers.splice(0)) memory.close();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("session memory transform ownership", () => {
	it("does not enrich a pending predecessor result after close and releases operational status", async () => {
		let release: (result: AgentMessage[]) => void = () => {};
		const prior = vi.fn(
			() =>
				new Promise<AgentMessage[]>((resolve) => {
					release = resolve;
				}),
		);
		agent.transformContext = prior;
		const memory = install();
		const callback = agent.transformContext;
		if (!callback) throw new Error("missing callback");
		const retrieve = vi.spyOn(VerifiedMemoryStore.prototype, "retrieve");
		const pending = callback(messages);
		memory.close();
		release(messages);
		expect(await pending).toBe(messages);
		expect(retrieve).not.toHaveBeenCalled();
		expect(memory.status).toEqual({ state: "disabled", eligible: 0, omitted: 0 });
		expect(agent.transformContext).toBe(prior);
	});

	it.each([
		[0, 1, 2],
		[0, 2, 1],
		[1, 0, 2],
		[1, 2, 0],
		[2, 0, 1],
		[2, 1, 0],
	])("unlinks closed stacked transforms in close order %j", async (...order) => {
		const prior = vi.fn(async (input: AgentMessage[]) => input);
		agent.transformContext = prior;
		const memories = [install(), install(), install()];
		const retrieve = vi.spyOn(VerifiedMemoryStore.prototype, "retrieve");
		for (const [position, index] of order.entries()) {
			memories[index].close();
			retrieve.mockClear();
			await agent.transformContext?.(messages);
			expect(retrieve).toHaveBeenCalledTimes(2 - position);
		}
		expect(agent.transformContext).toBe(prior);
	});

	it("makes a retained closed callback inert and refuses new memory mutations", async () => {
		const memory = install();
		const callback = agent.transformContext;
		if (!callback) throw new Error("missing callback");
		await callback(messages);
		expect(memory.status.state).toBe("ready");
		memory.close();
		memory.close();
		expect(await callback(messages)).toBe(messages);
		expect(memory.status.state).toBe("disabled");
		expect(() => memory.remember({ path: "facts.txt", startLine: 1, endLine: 1 })).toThrow(/closed/);
		expect(() => memory.forget("missing")).toThrow(/closed/);
	});

	it("preserves unrelated callback ownership and predecessor errors/cancellation", async () => {
		const cause = new Error("predecessor failed");
		agent.transformContext = async () => {
			throw cause;
		};
		const memory = install();
		const callback = agent.transformContext;
		if (!callback) throw new Error("missing callback");
		await expect(callback(messages)).rejects.toBe(cause);
		const replacement = async (input: AgentMessage[]) => input;
		agent.transformContext = replacement;
		memory.close();
		expect(agent.transformContext).toBe(replacement);
		agent.transformContext = replacement;
		install();
		const abort = new AbortController();
		abort.abort();
		await expect(agent.transformContext?.(messages, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
	});
	it("keeps only live stacked owners after a deferred predecessor resolves", async () => {
		let release: (result: AgentMessage[]) => void = () => {};
		const prior = vi.fn(
			() =>
				new Promise<AgentMessage[]>((resolve) => {
					release = resolve;
				}),
		);
		agent.transformContext = prior;
		const first = install();
		const second = install();
		const third = install();
		const callback = agent.transformContext;
		if (!callback) throw new Error("missing callback");
		const pending = callback(messages);
		first.close();
		third.close();
		const retrieve = vi.spyOn(VerifiedMemoryStore.prototype, "retrieve");
		release(messages);
		expect((await pending).length).toBe(messages.length + 2);
		expect(retrieve).toHaveBeenCalledTimes(1);
		expect(first.status.state).toBe("disabled");
		expect(third.status.state).toBe("disabled");
		second.close();
		expect(agent.transformContext).toBe(prior);
	});

	it("preserves errors and the identical signal through closed captured wrappers", async () => {
		const cause = new Error("closed-chain predecessor");
		const prior = vi.fn(async (_input: AgentMessage[], signal?: AbortSignal) => {
			signal?.throwIfAborted();
			throw cause;
		});
		agent.transformContext = prior;
		const first = install();
		const callback = agent.transformContext;
		if (!callback) throw new Error("missing callback");
		first.close();
		const abort = new AbortController();
		await expect(callback(messages, abort.signal)).rejects.toBe(cause);
		expect(prior).toHaveBeenLastCalledWith(messages, abort.signal);
		abort.abort();
		await expect(callback(messages, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
	});
	it("does not start predecessor work for an already-aborted request", async () => {
		const prior = vi.fn(async (input: AgentMessage[]) => input);
		agent.transformContext = prior;
		install();
		const abort = new AbortController();
		const cause = new Error("cancelled before transform");
		abort.abort(cause);
		const retrieve = vi.spyOn(VerifiedMemoryStore.prototype, "retrieve");
		await expect(agent.transformContext?.(messages, abort.signal)).rejects.toBe(cause);
		expect(prior).not.toHaveBeenCalled();
		expect(retrieve).not.toHaveBeenCalled();
	});
});
