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
 * sane clock were flaking on host noise. Wrapping `Date.now` here keeps every
 * test's clock non-decreasing; tests that mock `Date.now` themselves
 * (vi.spyOn / fake timers) replace this wrapper, so their semantics are
 * unchanged.
 */
const LIVE = process.env.LIVE_E2E === "1";

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

Date.now = createMonotonicNow(Date.now);

const PROVIDER_PREFIX =
	/^(ANTHROPIC_|OPENAI_|GROK_|XAI_|DEEPSEEK_|GEMINI_|GOOGLE_API_KEY|MISTRAL_|GROQ_|CEREBRAS_|OPENROUTER_|AWS_|GH_TOKEN|GITHUB_TOKEN|GITLAB_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN)/;

for (const key of Object.keys(process.env)) {
	if (key.startsWith("OMK_")) {
		delete process.env[key];
		continue;
	}
	if (!LIVE && PROVIDER_PREFIX.test(key)) {
		delete process.env[key];
	}
}
