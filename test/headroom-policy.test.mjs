import test from "node:test";
import assert from "node:assert/strict";

const {
  resolveHeadroomThreshold,
  isHeadroomEnabled,
  evaluateHeadroom,
  maybeCompactWithHeadroom,
} = await import("../dist/runtime/headroom-policy.js");

// ─── resolveHeadroomThreshold ────────────────────────────────────────────────

test("resolveHeadroomThreshold returns 0.90 by default", () => {
  assert.equal(resolveHeadroomThreshold({}), 0.90);
  assert.equal(resolveHeadroomThreshold({ OMK_HEADROOM_THRESHOLD: "" }), 0.90);
  assert.equal(resolveHeadroomThreshold({ OMK_HEADROOM_THRESHOLD: "abc" }), 0.90);
});

test("resolveHeadroomThreshold reads env and clamps to 0.50..0.99", () => {
  assert.equal(resolveHeadroomThreshold({ OMK_HEADROOM_THRESHOLD: "0.85" }), 0.85);
  assert.equal(resolveHeadroomThreshold({ OMK_HEADROOM_THRESHOLD: "0.50" }), 0.50);
  assert.equal(resolveHeadroomThreshold({ OMK_HEADROOM_THRESHOLD: "0.99" }), 0.99);
  // below floor -> clamped to 0.50
  assert.equal(resolveHeadroomThreshold({ OMK_HEADROOM_THRESHOLD: "0.10" }), 0.50);
  // above ceiling -> clamped to 0.99
  assert.equal(resolveHeadroomThreshold({ OMK_HEADROOM_THRESHOLD: "1.50" }), 0.99);
});

// ─── isHeadroomEnabled ──────────────────────────────────────────────────────

test("isHeadroomEnabled returns true by default and false for off/0/false", () => {
  assert.equal(isHeadroomEnabled({}), true);
  assert.equal(isHeadroomEnabled({ OMK_HEADROOM: "" }), true);
  assert.equal(isHeadroomEnabled({ OMK_HEADROOM: "on" }), true);
  assert.equal(isHeadroomEnabled({ OMK_HEADROOM: "1" }), true);
  assert.equal(isHeadroomEnabled({ OMK_HEADROOM: "off" }), false);
  assert.equal(isHeadroomEnabled({ OMK_HEADROOM: "0" }), false);
  assert.equal(isHeadroomEnabled({ OMK_HEADROOM: "false" }), false);
});

// ─── evaluateHeadroom ───────────────────────────────────────────────────────

test("evaluateHeadroom returns shouldCompact=false when disabled", () => {
  const env = { OMK_HEADROOM: "off" };
  const decision = evaluateHeadroom({ usedTokens: 190_000, contextWindow: 200_000, env });
  assert.equal(decision.shouldCompact, false);
  assert.match(decision.reason, /disabled/);
});

test("evaluateHeadroom treats non-finite context windows as unknown", () => {
  const decision = evaluateHeadroom({ usedTokens: 190_000, contextWindow: Number.NaN, env: {} });
  assert.equal(decision.shouldCompact, false);
  assert.equal(decision.utilization, 0);
  assert.match(decision.reason, /unknown/);
});

test("evaluateHeadroom returns shouldCompact=false below 90% threshold", () => {
  const env = {};
  // 170k / 200k = 85% < 90%
  const decision = evaluateHeadroom({ usedTokens: 170_000, contextWindow: 200_000, env });
  assert.equal(decision.shouldCompact, false);
  assert.equal(decision.threshold, 0.90);
  assert.ok(decision.utilization < 0.90);
});

test("evaluateHeadroom returns shouldCompact=true at exactly 90%", () => {
  const env = {};
  const decision = evaluateHeadroom({ usedTokens: 180_000, contextWindow: 200_000, env });
  assert.equal(decision.shouldCompact, true);
  assert.equal(decision.utilization, 0.90);
  assert.match(decision.reason, />= threshold/);
});

test("evaluateHeadroom returns shouldCompact=true above 90%", () => {
  const env = {};
  const decision = evaluateHeadroom({ usedTokens: 195_000, contextWindow: 200_000, env });
  assert.equal(decision.shouldCompact, true);
  assert.ok(decision.utilization > 0.90);
});

// ─── maybeCompactWithHeadroom ───────────────────────────────────────────────

test("maybeCompactWithHeadroom returns via=headroom on success", async () => {
  const decision = { shouldCompact: true, utilization: 0.95, threshold: 0.90, usedTokens: 190_000, contextWindow: 200_000, reason: "test" };
  const result = await maybeCompactWithHeadroom({
    decision,
    text: "some context text",
    runHeadroom: async (_text) => "compacted output",
  });
  assert.equal(result.compacted, true);
  assert.equal(result.via, "headroom");
});

test("maybeCompactWithHeadroom falls back when headroom returns null", async () => {
  const decision = { shouldCompact: true, utilization: 0.95, threshold: 0.90, usedTokens: 190_000, contextWindow: 200_000, reason: "test" };
  let fallbackCalled = false;
  const result = await maybeCompactWithHeadroom({
    decision,
    text: "some context text",
    runHeadroom: async (_text) => null,
    fallback: async () => { fallbackCalled = true; },
  });
  assert.equal(result.compacted, true);
  assert.equal(result.via, "fallback");
  assert.equal(fallbackCalled, true);
});

test("maybeCompactWithHeadroom returns fallback compactedText when direct headroom command is unavailable", async () => {
  const decision = { shouldCompact: true, utilization: 0.95, threshold: 0.90, usedTokens: 190_000, contextWindow: 200_000, reason: "test" };
  const result = await maybeCompactWithHeadroom({
    decision,
    text: "some context text",
    runHeadroom: async (_text) => null,
    fallbackText: async () => "structured compact context",
  });
  assert.equal(result.compacted, true);
  assert.equal(result.via, "fallback");
  assert.equal(result.compactedText, "structured compact context");
  assert.match(result.reason ?? "", /structured fallback/);
});

test("maybeCompactWithHeadroom returns via=none when shouldCompact is false", async () => {
  const decision = { shouldCompact: false, utilization: 0.50, threshold: 0.90, usedTokens: 100_000, contextWindow: 200_000, reason: "ok" };
  const result = await maybeCompactWithHeadroom({ decision });
  assert.equal(result.compacted, false);
  assert.equal(result.via, "none");
});

test("maybeCompactWithHeadroom never throws even if runner and fallback fail", async () => {
  const decision = { shouldCompact: true, utilization: 0.95, threshold: 0.90, usedTokens: 190_000, contextWindow: 200_000, reason: "test" };
  const result = await maybeCompactWithHeadroom({
    decision,
    text: "context",
    runHeadroom: async () => { throw new Error("headroom crashed"); },
    fallback: async () => { throw new Error("fallback crashed"); },
  });
  assert.equal(result.compacted, false);
  assert.equal(result.via, "none");
});
