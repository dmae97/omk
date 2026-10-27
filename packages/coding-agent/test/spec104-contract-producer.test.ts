/** Spec 104 phase 3 unit: declaration parsing, declared-only required tools, the producer and its channel. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import {
	GoalRequiredTools,
	parseRequiredToolsDeclaration,
} from "../src/core/extensions/builtin/goal-controller-required-tools.ts";
import { GoalAcceptance } from "../src/core/goal-acceptance.ts";
import { goalKeyOf } from "../src/core/goal-verification.ts";
import type { RequiredToolContract } from "../src/core/required-tools.ts";
import {
	onRequiredCapability,
	onRequiredToolContract,
	REQUIRED_CAPABILITY_CHANNEL,
	REQUIRED_TOOLS_CONTRACT_CHANNEL,
	reportRequiredCapability,
} from "../src/core/required-tools-channel.ts";

afterEach(() => vi.unstubAllEnvs());

const at = "2026-10-21T00:00:00.000Z";
const goal = (status = "active") =>
	({ ref: { id: "session", revision: 1 }, status, createdAt: at, updatedAt: at, generationStartedAt: at }) as never;
const segment = goalKeyOf(goal());

function producer() {
	const events = createEventBus();
	const entries: Array<[string, unknown]> = [];
	const omk = { events, appendEntry: (type: string, data: unknown) => entries.push([type, data]) } as never;
	const acceptance = new GoalAcceptance();
	const contracts: Array<RequiredToolContract | undefined> = [];
	onRequiredToolContract(events, (contract) => contracts.push(contract));
	return { events, entries, acceptance, contracts, required: new GoalRequiredTools(omk, acceptance) };
}

describe("spec 104 phase 3: --requires declaration", () => {
	it("flag off: the text is returned unchanged and nothing is required", () => {
		expect(parseRequiredToolsDeclaration("--requires a__b npm test")).toEqual({
			command: "--requires a__b npm test",
			tools: [],
		});
	});

	it("flag on: splits explicit tool names off the command", () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		expect(parseRequiredToolsDeclaration("--requires a__b,c__d npm test")).toEqual({
			command: "npm test",
			tools: ["a__b", "c__d"],
		});
		expect(parseRequiredToolsDeclaration("--requires=a__b npm test").tools).toEqual(["a__b"]);
	});

	it("flag on: nothing is inferred from a command that merely names a tool", () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		expect(parseRequiredToolsDeclaration("npx playwright test # browser__verify")).toEqual({
			command: "npx playwright test # browser__verify",
			tools: [],
		});
	});

	it("flag on: a declaration without a command or with a malformed name is refused", () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		expect(() => parseRequiredToolsDeclaration("--requires a__b")).toThrow(/usage/);
		expect(() => parseRequiredToolsDeclaration("--requires a;b npm test")).toThrow(/usage/);
		expect(() => parseRequiredToolsDeclaration("--requires read npm test")).toThrow(
			/server__tool form; invalid: read\b/,
		);
		expect(() => parseRequiredToolsDeclaration("--requires a__b,__x npm test")).toThrow(/invalid: __x/);
	});
});

describe("spec 104 phase 3: GoalAcceptance declared tools", () => {
	it("keeps only what the approved check declared; a changed declaration is a new revision", () => {
		const acceptance = new GoalAcceptance();
		acceptance.approve(goal(), "npm test");
		expect(acceptance.requiredTools(goal())).toEqual([]);
		const before = acceptance.checkIdentity(goal())?.revision;
		acceptance.approve(goal(), "npm test", ["b__x", "a__y", "b__x"]);
		expect(acceptance.requiredTools(goal())).toEqual(["a__y", "b__x"]);
		expect(acceptance.checkIdentity(goal())?.revision).toBe((before ?? 0) + 1);
		acceptance.approve(goal(), "npm test", ["a__y", "b__x"]);
		expect(acceptance.checkIdentity(goal())?.revision).toBe((before ?? 0) + 1);
		acceptance.approve(goal(), undefined);
		expect(acceptance.requiredTools(goal())).toEqual([]);
	});
});

describe("spec 104 phase 3: GoalRequiredTools producer", () => {
	it("flag off: no contract, no listener, no entries", () => {
		const p = producer();
		p.acceptance.approve(goal(), "npm test", ["a__b"]);
		p.required.sync(goal());
		reportRequiredCapability(p.events, {
			state: "missing",
			taskSegmentId: segment,
			missing: ["a__b"],
			kind: "absent",
		});
		expect(p.required.enabled).toBe(false);
		expect(p.contracts).toEqual([]);
		expect(p.entries).toEqual([]);
	});

	it("flag on: publishes the declared contract keyed by the goal segment, once, and clears it", () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const p = producer();
		p.acceptance.approve(goal(), "npm test");
		p.required.sync(goal());
		expect(p.contracts).toEqual([]);
		p.acceptance.approve(goal(), "npm test", ["a__b"]);
		p.required.sync(goal());
		p.required.sync(goal());
		expect(p.contracts).toHaveLength(1);
		expect(p.contracts[0]).toMatchObject({ taskSegmentId: segment, source: "acceptance" });
		expect([...(p.contracts[0]?.tools ?? [])]).toEqual(["a__b"]);
		p.required.sync(goal("completed"));
		expect(p.contracts).toEqual([p.contracts[0], undefined]);
	});

	it("flag on: a missing report records the gap with counts only; a present report reopens release", async () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const p = producer();
		p.acceptance.approve(goal(), "npm test", ["a__b"]);
		p.required.sync(goal());
		reportRequiredCapability(p.events, { state: "present", taskSegmentId: segment, requiredCount: 1 });
		expect(p.entries).toEqual([]);
		reportRequiredCapability(p.events, {
			state: "missing",
			taskSegmentId: segment,
			missing: ["a__b"],
			kind: "absent",
		});
		expect(p.entries).toEqual([
			[
				"goal_required_capability",
				{ goalId: "session", state: "missing", kind: "absent", missingCount: 1, requiredCount: 1 },
			],
		]);
		const store = { transition: async () => goal("completed") } as never;
		await expect(p.acceptance.complete(store, goal(), "/nonexistent")).rejects.toThrow(/required tools unavailable/);
		reportRequiredCapability(p.events, { state: "present", taskSegmentId: segment, requiredCount: 1 });
		expect(p.entries[1]).toEqual([
			"goal_required_capability",
			{ goalId: "session", state: "present", requiredCount: 1 },
		]);
		expect(JSON.stringify(p.entries)).not.toContain("a__b");
	});

	it("flag on: reports for another segment and unbranded data are ignored", () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const p = producer();
		p.acceptance.approve(goal(), "npm test", ["a__b"]);
		p.required.sync(goal());
		reportRequiredCapability(p.events, {
			state: "missing",
			taskSegmentId: "other",
			missing: ["a__b"],
			kind: "absent",
		});
		p.events.emit(REQUIRED_CAPABILITY_CHANNEL, {
			state: "missing",
			taskSegmentId: segment,
			missing: ["a__b"],
			kind: "absent",
		});
		expect(p.entries).toEqual([]);
		const seen: unknown[] = [];
		onRequiredCapability(p.events, (report) => seen.push(report));
		onRequiredToolContract(p.events, (contract) => seen.push(contract));
		p.events.emit(REQUIRED_TOOLS_CONTRACT_CHANNEL, { contract: { taskSegmentId: "x", tools: new Set(["y"]) } });
		expect(seen).toEqual([]);
	});
});
