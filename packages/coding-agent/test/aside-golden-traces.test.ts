import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AsideController } from "../examples/extensions/aside-computer-use/controller.ts";
import {
	compareGoldenTrace,
	normalizeTrace,
	traceHash,
} from "../examples/extensions/aside-computer-use/golden-trace.ts";
import type { AuthorizerPolicy } from "../examples/extensions/aside-computer-use/risk-authorize.ts";
import type { BrowserAction, BrowserClient, Observation } from "../examples/extensions/aside-computer-use/types.ts";

interface FixtureCriterion {
	readonly id: string;
	readonly description: string;
}

interface Fixture {
	readonly id: string;
	readonly goal: string;
	readonly criteria: readonly FixtureCriterion[];
	readonly observation?: Observation;
	readonly observations?: readonly Observation[];
	readonly scriptedActions?: readonly BrowserAction[];
}

const testDir = dirname(fileURLToPath(import.meta.url));

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

const policy: AuthorizerPolicy = {
	deniedActions: ["payment", "account_deletion", "credential_export"],
	privilegedR3Actions: [],
	allowedOrigins: ["localhost:*"],
	allowReadAnyOrigin: false,
};

const fixtureCases = ["read-login-page", "navigate-local-docs"] as const;

type TraceEvent = Readonly<Record<string, unknown>>;

function scriptedObservations(fixture: Fixture): Observation[] {
	if (fixture.observations) return [...fixture.observations];
	if (fixture.observation) return [fixture.observation];
	throw new Error(`fixture ${fixture.id} must include at least one observation`);
}

async function runFixtureTrace(fixture: Fixture): Promise<TraceEvent[]> {
	const observations = scriptedObservations(fixture);
	const scriptedActions = [...(fixture.scriptedActions ?? [])];
	const trace: TraceEvent[] = [];
	let nextObservation = 0;
	let nextPlannedAction = 0;
	let nextExecutedAction = 0;

	const client: BrowserClient = {
		observe: async () => {
			const observation = observations[nextObservation];
			if (!observation) throw new Error(`fixture ${fixture.id} has no observation for step ${nextObservation + 1}`);
			nextObservation++;
			trace.push({ t: "observe", url: observation.url });
			return observation;
		},
		execute: async (action) => {
			const expected = scriptedActions[nextExecutedAction];
			nextExecutedAction++;
			trace.push({ t: "execute", kind: action.kind, url: action.url });
			return {
				ok: expected?.kind === action.kind && expected.url === action.url,
				raw: { content: [] },
			};
		},
		listTools: async () => [],
		close: async () => {},
	};
	const controller = new AsideController({
		client,
		planner: {
			nextAction: async () => {
				const action = scriptedActions[nextPlannedAction];
				nextPlannedAction++;
				return action ? { action } : { done: true };
			},
		},
		approve: async () => true,
		policy,
		evidenceDirectory: "/tmp/aside-evidence",
		maxSteps: 5,
		maxRetries: 1,
	});
	const result = await controller.runTask({
		goal: fixture.goal,
		criteria: fixture.criteria,
	});
	trace.push({ t: "result", status: result.status, finalUrl: result.finalUrl });
	return trace;
}

describe("golden trace helpers", () => {
	it("normalizes volatile fields and preserves canonical hash for reordered object keys", () => {
		const left = normalizeTrace([{ t: "observe", url: "/docs", timestamp: "now", payload: { b: 2, a: 1 } }]);
		const right = normalizeTrace([{ payload: { a: 1, b: 2 }, url: "/docs", t: "observe", traceId: "run-1" }]);
		expect(left).toEqual(right);
		expect(traceHash(left)).toBe(traceHash(right));
	});
});

describe("AsideController golden traces", () => {
	it.each(fixtureCases)("matches the %s semantic trace", async (fixtureName) => {
		const fixture = readJson<Fixture>(join(testDir, `fixtures/aside/${fixtureName}.json`));
		const golden = readJson<unknown[]>(join(testDir, `fixtures/aside/goldens/${fixtureName}.golden.json`));
		const trace = await runFixtureTrace(fixture);
		const comparison = compareGoldenTrace(trace, golden);
		expect(comparison.pass, comparison.summary).toBe(true);
	});
});
