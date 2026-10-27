import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Harness } from "./harness.ts";
import { compareBytes, enterFixedEnvironment, readOrWriteGolden } from "./session-equivalence.ts";
import { SCENARIOS } from "./session-equivalence-scenarios.ts";

beforeEach(() => {
	vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "0"); // characterizes the pre-106 path; lifecycle defaults on
});
afterEach(() => {
	vi.unstubAllEnvs();
});

/** Deterministic run/request ids: `randomUUID` counts instead of drawing entropy. */
vi.mock("node:crypto", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:crypto")>();
	let n = 0;
	const randomUUID = () => `00000000-0000-4000-8000-${(n++).toString(16).padStart(12, "0")}`;
	return { ...actual, default: { ...actual, randomUUID }, randomUUID };
});

let harness: Harness | undefined;
let leave: (() => void) | undefined;
afterEach(() => {
	harness?.cleanup();
	harness = undefined;
	leave?.();
	leave = undefined;
	vi.restoreAllMocks();
});

describe("agent-session split equivalence (spec agent-session-split §5)", () => {
	for (const [name, run] of Object.entries(SCENARIOS)) {
		it(`${name}: every request, every event and the trace match the golden byte for byte`, async () => {
			leave = enterFixedEnvironment();
			const result = await run();
			harness = result.harness;
			const { golden, actual } = readOrWriteGolden(name, result.record);
			if (name !== "spec103b-trace") {
				expect(result.record.requests.length).toBeGreaterThan(0);
				expect(result.record.events.length).toBeGreaterThan(0);
			}
			expect(compareBytes(golden, actual)).toEqual({ equal: true });
		});
	}
});
