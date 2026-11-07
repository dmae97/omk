/**
 * Hermetic test environment: scrub machine-level OMK_* and provider credential
 * variables so test outcomes never depend on the developer shell.
 *
 * Rationale: this repo's tests were failing on machines whose shell exported
 * OMK_YOLO=1 / OMK_COMMAND_SAFETY=0 / ANTHROPIC_API_KEY — safety-gate suites
 * saw the gate disabled by env, and live-API e2e suites ran against expired
 * credentials instead of skipping. Tests must be deterministic everywhere.
 *
 * Opt-in escape hatch: `LIVE_E2E=1` keeps provider credentials so the live
 * API suites (describe.skipIf(!API_KEY)) run on purpose.
 *
 * Clock: some hosts (observed on WSL2) roll `Date.now()` backward when the
 * hypervisor resyncs wall time. The authority store correctly refuses a
 * decreasing trusted clock (`clock_anomaly`), and the boundary suites cover
 * that refusal with explicit mocks — but integration tests that only need a
 * sane clock were flaking on host noise. Date.now and no-argument Date construction
 * share an epoch anchored to monotonic elapsed time, avoiding resyncs in either
 * direction. Explicit dates and injected verification clocks stay untouched, so
 * anomaly tests can still exercise fail-closed behavior.
 *
 * Agent dir: `OMK_CODING_AGENT_DIR` (ENV_AGENT_DIR in src/config.ts) survives
 * the scrub on purpose. test.sh points it at a throwaway directory, so the
 * suite resolves the agent dir away from the live ~/.omk/agent; scrubbing the
 * variable here would send every spawned child back to the live store.
 *
 * Headroom probe (spec 046): the control panel probes `headroom`/`python3` for a version in the
 * background. Every test starts with a probe spawn that answers "no version" without running anything,
 * and a fresh probe cache, so tests that build `InteractiveMode` or render the control panel never start
 * real processes. Probe tests call `setHeadroomProbeSpawnForTesting(undefined)` for the real spawn or pass
 * their own fake. This replaces the function in this worker only; omk child processes spawned by e2e
 * tests still run the real probe.
 */
import { beforeEach } from "vitest";
import { setHeadroomProbeSpawnForTesting } from "../src/modes/interactive/components/headroom-version-probe.ts";

const LIVE = process.env.LIVE_E2E === "1";
const PRESERVED_ENV_KEYS = new Set(["OMK_CODING_AGENT_DIR"]);

/** Wrap a millisecond clock so its output never decreases. */
export function createMonotonicNow(source: () => number): () => number {
	let last = Number.NEGATIVE_INFINITY;
	return () => {
		const sampled = source();
		if (sampled > last) {
			last = sampled;
		}
		return last;
	};
}

/** Anchor wall time once; subsequent host resyncs cannot consume deadlines or reverse receipts. */
export function createStableNow(wall: () => number, elapsed: () => number): () => number {
	const epoch = wall();
	const started = elapsed();
	return createMonotonicNow(() => epoch + Math.floor(elapsed() - started));
}

Date.now = createStableNow(Date.now, () => Number(process.hrtime.bigint() / 1_000_000n));
globalThis.Date = new Proxy(Date, {
	apply(target) {
		return new target(Date.now()).toString();
	},
	construct(target, args, newTarget) {
		return Reflect.construct(target, args.length === 0 ? [Date.now()] : args, newTarget);
	},
});

const PROVIDER_PREFIX =
	/^(ANTHROPIC_|OPENAI_|GROK_|XAI_|DEEPSEEK_|GEMINI_|GOOGLE_API_KEY|MISTRAL_|GROQ_|CEREBRAS_|OPENROUTER_|AWS_|GH_TOKEN|GITHUB_TOKEN|GITLAB_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN)/;

for (const key of Object.keys(process.env)) {
	if (PRESERVED_ENV_KEYS.has(key)) {
		continue;
	}
	if (key.startsWith("OMK_")) {
		delete process.env[key];
		continue;
	}
	if (!LIVE && PROVIDER_PREFIX.test(key)) {
		delete process.env[key];
	}
}

const noHeadroomInstalled = async (): Promise<string | null> => null;
setHeadroomProbeSpawnForTesting(noHeadroomInstalled);
beforeEach(() => {
	setHeadroomProbeSpawnForTesting(noHeadroomInstalled);
});
