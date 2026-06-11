import { type AssistantMessage, fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { AgentHarness } from "../../src/harness/agent-harness.ts";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { InMemorySessionStorage } from "../../src/harness/session/memory-storage.ts";
import { Session } from "../../src/harness/session/session.ts";

const registrations: Array<{ unregister(): void }> = [];

afterEach(() => {
	for (const registration of registrations.splice(0)) {
		registration.unregister();
	}
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve = () => {};
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("AgentHarness re-entrant run cleanup (regression)", () => {
	// Regression for: handleAgentEvent flipped phase to "idle" and emitted
	// agent_end/settled while the old run was still unwinding. A settled listener
	// that fire-and-forgets prompt() passed the busy check, and the old run's
	// unconditional cleanup then clobbered the new run's runAbortController
	// (disarming abort()) and runPromise (so waitForIdle() resolved while the new
	// run was still streaming).
	it("keeps abort() and waitForIdle() armed for a run started from a settled listener", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		const secondRunStarted = deferred();
		let secondRunSignal: AbortSignal | undefined;
		registration.setResponses([
			() => fauxAssistantMessage("first"),
			async (_context, options) => {
				secondRunSignal = options?.signal;
				secondRunStarted.resolve();
				// Block mid-provider-call until the second run is aborted.
				await new Promise<void>((resolve) => {
					if (options?.signal?.aborted) {
						resolve();
						return;
					}
					options?.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				return fauxAssistantMessage("second");
			},
		]);
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session: new Session(new InMemorySessionStorage()),
			model: registration.getModel(),
		});
		const firstRunEvents: string[] = [];
		let secondPrompt: Promise<AssistantMessage> | undefined;
		harness.subscribe((event) => {
			if (!secondPrompt) firstRunEvents.push(event.type);
			if (event.type === "settled" && !secondPrompt) {
				// Fire-and-forget: settled's nextTurnCount payload invites the app
				// to start the next prompt right away.
				secondPrompt = harness.prompt("second");
				void secondPrompt.catch(() => {});
			}
		});

		await harness.prompt("first");
		await secondRunStarted.promise;

		// The first run has fully unwound; the second run is mid-provider-call.
		expect(secondPrompt).toBeDefined();

		// The externally observable event order of the first run is preserved.
		const agentEndIndex = firstRunEvents.indexOf("agent_end");
		const settledIndex = firstRunEvents.indexOf("settled");
		expect(agentEndIndex).toBeGreaterThanOrEqual(0);
		expect(settledIndex).toBeGreaterThan(agentEndIndex);

		// The first run's unwind must not have clobbered the second run's phase.
		await expect(harness.prompt("third")).rejects.toThrow("AgentHarness is busy");

		// waitForIdle() must not resolve while the second run is in flight.
		let idleResolved = false;
		const idlePromise = harness.waitForIdle().then(() => {
			idleResolved = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(idleResolved).toBe(false);

		// abort() must actually abort the in-flight second run, not a stale one.
		await harness.abort();
		expect(secondRunSignal?.aborted).toBe(true);
		await idlePromise;
		expect(idleResolved).toBe(true);

		const second = await secondPrompt;
		expect(second?.role).toBe("assistant");
		expect(second?.stopReason).toBe("aborted");

		// The harness is genuinely idle again: a fresh prompt is accepted.
		registration.setResponses([() => fauxAssistantMessage("fourth")]);
		await expect(harness.prompt("fourth")).resolves.toMatchObject({ role: "assistant" });
	});
});
