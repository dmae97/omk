/**
 * Observation kernel tests — U1/U2/U3 of the upgraded SoL-Pi design.
 *
 * Covers: observation identity binds execution events (not just content),
 * byte-scoped reads snap to UTF-8 boundaries and never cross a session scope,
 * the coverage gate drops views that lose required fact atoms, and observation
 * mode records the choice without changing the model's input.
 */

import { describe, expect, it } from "vitest";
import {
	chooseView,
	createObservationModeRecorder,
	extractFacts,
	makeViews,
	ObservationStore,
	sha256Hex,
} from "../src/observation/index.ts";

const enc = new TextEncoder();

function store(bytes: Uint8Array, extra: Partial<Parameters<ObservationStore["put"]>[0]> = {}) {
	const s = new ObservationStore();
	return s.put({
		sessionId: "sess-1",
		runId: "run-1",
		operationId: "op-1",
		sequence: 0,
		bytes,
		status: "exit",
		...extra,
	});
}

describe("observation identity and store", () => {
	it("binds run/operation/sequence, not just content", () => {
		const bytes = enc.encode("identical output");
		const a = store(bytes, { operationId: "op-A", sequence: 0 });
		const b = store(bytes, { operationId: "op-B", sequence: 0 });
		const c = store(bytes, { operationId: "op-A", sequence: 1 });
		expect(a.observationId).not.toBe(b.observationId);
		expect(a.observationId).not.toBe(c.observationId);
		expect(a.rawDigest).toBe(b.rawDigest); // same bytes, same digest — distinct events
	});

	it("digest matches raw bytes", () => {
		const bytes = enc.encode("hello");
		const obs = store(bytes);
		expect(obs.rawDigest).toBe(sha256Hex(bytes));
		expect(obs.byteLength).toBe(5);
	});

	it("round-trips a full byte-range read", () => {
		const s2 = new ObservationStore();
		const o = s2.put({
			sessionId: "sess-1",
			runId: "r",
			operationId: "o",
			sequence: 0,
			bytes: enc.encode("line1\nline2\n"),
			status: "exit",
		});
		const res = s2.read({ observationId: o.observationId, scopeSessionId: "sess-1", byteOffset: 0, maxBytes: 64 });
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.read.text).toBe("line1\nline2\n");
			expect(res.read.eof).toBe(true);
			expect(res.read.truncated).toBe(false);
		}
	});

	it("snaps a mid-codepoint offset to a UTF-8 boundary", () => {
		const s = new ObservationStore();
		// 'é' is 2 bytes (0xC3 0xA9); offset 1 lands mid-codepoint.
		const o = s.put({
			sessionId: "sess-1",
			runId: "r",
			operationId: "o",
			sequence: 0,
			bytes: enc.encode("aéb"),
			status: "exit",
		});
		const res = s.read({ observationId: o.observationId, scopeSessionId: "sess-1", byteOffset: 2, maxBytes: 64 });
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.read.normalized).toBe(true);
			expect(res.read.byteOffset).toBe(1); // snapped back to 'é' lead byte
		}
		const strict = s.read({
			observationId: o.observationId,
			scopeSessionId: "sess-1",
			byteOffset: 2,
			maxBytes: 64,
			strict: true,
		});
		expect(strict.ok).toBe(false);
		if (!strict.ok) expect(strict.error).toBe("utf8-boundary");
	});

	it("refuses a cross-session read", () => {
		const s = new ObservationStore();
		const o = s.put({
			sessionId: "sess-1",
			runId: "r",
			operationId: "o",
			sequence: 0,
			bytes: enc.encode("secret"),
			status: "exit",
		});
		const res = s.read({ observationId: o.observationId, scopeSessionId: "sess-2", byteOffset: 0, maxBytes: 64 });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toBe("scope-mismatch");
	});

	it("fails closed on capacity instead of evicting evidence", () => {
		const s = new ObservationStore({ maxObservations: 1, maxTotalBytes: 1024 });
		s.put({ sessionId: "s", runId: "r", operationId: "o1", sequence: 0, bytes: enc.encode("a"), status: "exit" });
		expect(() =>
			s.put({ sessionId: "s", runId: "r", operationId: "o2", sequence: 1, bytes: enc.encode("b"), status: "exit" }),
		).toThrow(/archive-unavailable/);
	});
});

describe("deterministic views and coverage gate", () => {
	function obsWith(text: string) {
		const s = new ObservationStore();
		return s.put({
			sessionId: "sess-1",
			runId: "r",
			operationId: "o",
			sequence: 0,
			bytes: enc.encode(text),
			status: "exit",
		});
	}

	it("extracts exit-code and failure atoms", () => {
		const obs = obsWith("PASS setup\nFAIL auth\nexit code: 1\n");
		const facts = extractFacts(obs.bytes);
		const ids = facts.map((f) => f.id);
		expect(ids).toContain("exit-code");
		expect(ids).toContain("test-failure");
	});

	it("pointer view drops every required fact", () => {
		const obs = obsWith("FAIL auth\nexit code: 1\n");
		const views = makeViews(obs, ["test-failure", "exit-code"]);
		const pointer = views.find((v) => v.viewKind === "pointer");
		expect(pointer?.coverageStatus).toBe("partial");
		expect(pointer?.missingRequiredFactIds).toContain("test-failure");
	});

	it("chooseView picks the smallest coverage-complete view in budget", () => {
		const obs = obsWith("PASS setup\nFAIL auth\nexit code: 1\n".repeat(400)); // large
		const views = makeViews(obs, ["test-failure", "exit-code"]);
		const chosen = chooseView(views, 1_000_000, ["test-failure", "exit-code"]);
		expect(chosen).not.toBeNull();
		// evidence view preserves both atoms at a fraction of the full text
		expect(chosen?.viewKind).toBe("evidence");
		expect(chosen?.coverageStatus).toBe("complete");
	});

	it("returns null (infeasible) instead of dropping a required fact", () => {
		const obs = obsWith("PASS setup\nFAIL auth\n");
		const views = makeViews(obs, ["exit-code"]); // no exit-code present
		const chosen = chooseView(views, 1_000_000, ["exit-code"]);
		expect(chosen).toBeNull();
	});

	it("marks coverage unknown when no required facts are given", () => {
		const obs = obsWith("hello");
		const views = makeViews(obs, []);
		expect(views.every((v) => v.coverageStatus === "unknown")).toBe(true);
	});
});

describe("observation-mode recorder", () => {
	it("records the gated choice and saving upper bound without changing input", () => {
		const s = new ObservationStore();
		const obs = s.put({
			sessionId: "sess-1",
			runId: "r",
			operationId: "o",
			sequence: 0,
			bytes: enc.encode("PASS\nFAIL t1\nexit code: 1\n".repeat(200)),
			status: "exit",
		});
		const views = makeViews(obs, ["test-failure", "exit-code"]);
		const chosen = chooseView(views, 1_000_000, ["test-failure", "exit-code"]);
		const observedTokens = Math.ceil(obs.byteLength / 4); // what the model actually got (full)
		const recorder = createObservationModeRecorder();
		const rec = recorder.record({
			observationId: obs.observationId,
			observedTokens,
			chosenView: chosen,
			requiredFactIds: ["test-failure", "exit-code"],
		});
		expect(rec.chosenViewKind).toBe("evidence");
		expect(rec.savedTokensUpperBound).toBeGreaterThan(0);
		expect(rec.coverageStatus).toBe("complete");
		expect(rec.infeasible).toBe(false);
	});

	it("marks an infeasible choice as such, never an implicit success", () => {
		const recorder = createObservationModeRecorder();
		const rec = recorder.record({ observationId: "x", observedTokens: 100, chosenView: null });
		expect(rec.infeasible).toBe(true);
		expect(rec.savedTokensUpperBound).toBe(0);
		const s = recorder.summary();
		expect(s.infeasible).toBe(1);
		expect(s.coverageUnknown).toBe(1);
	});
});
