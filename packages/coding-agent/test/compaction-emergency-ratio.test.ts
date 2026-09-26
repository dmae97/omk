/**
 * The emergency compaction ratio has to be reachable.
 *
 * The emergency branch is the only one that compacts a *disarmed* hysteresis,
 * and the local admission gate refuses any turn above the capacity ratio — so
 * an emergency threshold above that line can never fire, and a session pinned
 * at "context limit reached" has no automatic way out. These tests pin the
 * clamp and the hysteresis behaviour it produces.
 */
import type { Model } from "omk-ai";
import { describe, expect, it } from "vitest";
import { createCompactionHysteresisConfig, stepCompactionHysteresis } from "../src/core/compaction/hysteresis.ts";
import { emergencyCompactionRatio } from "../src/core/session-input-admission.ts";

const SWE2 = {
	provider: "devin",
	id: "swe-2",
	contextWindow: 262_000,
	maxTokens: 16_384,
} as unknown as Model<any>;

/** window − response reserve − 10% safety margin, exactly as the gate computes it. */
const CAPACITY = (262_000 - 16_384 - 26_200) / 262_000;

describe("emergencyCompactionRatio", () => {
	it("clamps the default below the admission capacity that refuses the turn", () => {
		const ratio = emergencyCompactionRatio(0.7, undefined, SWE2, 262_000);
		expect(ratio).toBeLessThan(CAPACITY);
		expect(ratio).toBeGreaterThan(0.7);
		expect(ratio).toBeCloseTo(CAPACITY * 0.95, 5);
	});

	it("floors a user-configured ratio at the trigger, as the pipeline always did", () => {
		expect(emergencyCompactionRatio(0.7, 0.5, SWE2, 262_000)).toBe(0.7);
	});

	it("never drops below the trigger ratio", () => {
		expect(emergencyCompactionRatio(0.9, undefined, SWE2, 262_000)).toBe(0.9);
	});

	it("leaves the configured default alone when no window is known", () => {
		expect(emergencyCompactionRatio(0.7, undefined, undefined, 0)).toBe(0.98);
	});

	it("compacts a disarmed hysteresis before the gate would refuse", () => {
		const trigger = 0.7;
		const clamped = createCompactionHysteresisConfig({
			rearmRatio: trigger * 0.75,
			triggerRatio: trigger,
			emergencyRatio: emergencyCompactionRatio(trigger, undefined, SWE2, 262_000),
		});
		const atCapacity = stepCompactionHysteresis({
			config: clamped,
			state: { armed: false },
			ratio: CAPACITY,
		});
		expect(atCapacity.action).toBe("compact");
		expect(atCapacity.reason).toBe("emergency_threshold_reached");

		// The old 0.98 default sat above capacity: disarmed + over capacity = stuck.
		const unreachable = createCompactionHysteresisConfig({
			rearmRatio: 0.5,
			triggerRatio: trigger,
			emergencyRatio: 0.98,
		});
		expect(stepCompactionHysteresis({ config: unreachable, state: { armed: false }, ratio: CAPACITY }).action).toBe(
			"wait",
		);
	});
});
