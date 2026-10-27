/** Spec 104 follow-up: the contract listener a session installs on its event bus is released on dispose. */
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTurnAdmission, type TurnAdmissionSession } from "../../src/core/agent-session-turn-admission-host.ts";
import { createEventBus, type EventBus } from "../../src/core/event-bus.ts";
import { RequiredCapabilityUnavailable } from "../../src/core/required-tools.ts";
import { publishRequiredToolContract, REQUIRED_TOOLS_CONTRACT_CHANNEL } from "../../src/core/required-tools-channel.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
	for (const h of harnesses.splice(0)) h.cleanup();
	vi.unstubAllEnvs();
});

/** One bus shared by every session, counting live listeners on the contract channel. */
function sharedBus(): EventBus & { readonly listeners: () => number } {
	const bus = createEventBus();
	let live = 0;
	return {
		emit: bus.emit,
		on(channel, handler) {
			const off = bus.on(channel, handler);
			if (channel !== REQUIRED_TOOLS_CONTRACT_CHANNEL) return off;
			live++;
			let done = false;
			return () => {
				if (!done) live--;
				done = true;
				off();
			};
		},
		listeners: () => live,
	};
}

async function sessionOn(bus: EventBus): Promise<Harness> {
	const loader = { ...createTestResourceLoader(), getEventBus: () => bus };
	const h = await createHarness({ resourceLoader: loader });
	harnesses.push(h);
	return h;
}

const contract = (tool: string) => ({ taskSegmentId: "goal-1", tools: new Set([tool]), source: "acceptance" as const });

describe("spec 104: contract listener lifetime", () => {
	it("create + dispose N sessions on one shared bus: listener count returns to baseline", async () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const bus = sharedBus();
		const baseline = bus.listeners();
		const created = [];
		for (let i = 0; i < 5; i++) created.push(await sessionOn(bus));
		expect(bus.listeners()).toBe(baseline + 5);

		for (const h of created) h.session.dispose();
		await vi.waitFor(() => expect(bus.listeners()).toBe(baseline));
	});

	it("a contract published after dispose reaches no disposed session; a live session still gets it", async () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const bus = sharedBus();
		const disposed = await sessionOn(bus);
		const live = await sessionOn(bus);
		disposed.session.dispose();
		await vi.waitFor(() => expect(bus.listeners()).toBe(1));

		publishRequiredToolContract(bus, contract("browser__verify"));

		live.setResponses([fauxAssistantMessage("ok")]);
		const error = await live.session.prompt("hello").catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(RequiredCapabilityUnavailable);
		expect(bus.listeners()).toBe(1);
	});

	it("re-installing admission on the same session replaces its listener instead of adding one", async () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const bus = sharedBus();
		const h = await sessionOn(bus);
		expect(bus.listeners()).toBe(1);
		installTurnAdmission(h.session as unknown as TurnAdmissionSession);
		installTurnAdmission(h.session as unknown as TurnAdmissionSession);
		expect(bus.listeners()).toBe(1);
		h.session.dispose();
		await vi.waitFor(() => expect(bus.listeners()).toBe(0));
	});

	it("disposing one session never releases another session's listener", async () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const bus = sharedBus();
		const a = await sessionOn(bus);
		await sessionOn(bus);
		a.session.dispose();
		await vi.waitFor(() => expect(bus.listeners()).toBe(1));
	});

	it("flag off: no listener is ever installed", async () => {
		const bus = sharedBus();
		const h = await sessionOn(bus);
		expect(bus.listeners()).toBe(0);
		h.session.dispose();
		expect(bus.listeners()).toBe(0);
	});
});
