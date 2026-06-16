import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_STRUCTURED_COMPACTION_CONTRACT,
  STRUCTURED_COMPACTION_V2_SCHEMA_VERSION,
  buildStructuredCompactionText,
  buildTypedStructuredCompactionContract,
  parseTypedStructuredCompactionContract,
  structuredCompactionInstruction,
  validateStructuredCompaction,
} from "../dist/runtime/structured-compaction.js";

function capsule(overrides = {}) {
  return {
    runId: "run",
    nodeId: "node",
    goal: "compact safely",
    task: "Implement structured compaction contract for native runtime handoff",
    system: "Preserve safety constraints and evidence required gates.",
    dependencySummaries: [],
    relevantFiles: [],
    graphMemory: [],
    priorAttempts: [],
    evidenceRequirements: [{ gate: "command-pass", required: true }],
    budget: { maxInputTokens: 1000, reservedOutputTokens: 100, maxFileTokens: 100, maxToolResultTokens: 100, maxMemoryFacts: 3, compression: "summary" },
    node: {
      id: "node",
      name: "Node",
      role: "coder",
      dependsOn: [],
      status: "running",
      retries: 0,
      maxRetries: 1,
      routing: {
        provider: "codex",
        risk: "write",
        sandboxMode: "workspace-write",
        readOnly: false,
        approvalPolicy: "auto",
        evidenceRequired: true,
        assignedProviderCapabilities: ["write", "patch"],
      },
    },
    ...overrides,
  };
}

test("structured compaction contract validates required routing/evidence/safety sections", () => {
  const sample = capsule();
  const missing = validateStructuredCompaction("short summary only", sample);
  assert.equal(missing.ok, false);
  assert.ok(missing.missing.includes("task"));
  assert.ok(missing.missing.includes("evidence requirements"));

  const validLegacy = validateStructuredCompaction([
    "Implement structured compaction contract for native runtime handoff",
    "provider codex risk write sandboxMode workspace-write",
    "command-pass evidence required",
    "preserve safety constraints and capabilities write patch",
  ].join("\n"), sample);

  assert.equal(validLegacy.ok, true);
  assert.equal(validLegacy.contract.schemaVersion, DEFAULT_STRUCTURED_COMPACTION_CONTRACT.schemaVersion);
  assert.match(structuredCompactionInstruction(), /omk\.structured-compaction\.v1/);

  const generated = buildStructuredCompactionText(sample);
  const generatedValidation = validateStructuredCompaction(generated, sample);
  assert.equal(generatedValidation.ok, true);
  assert.equal(generatedValidation.contract.schemaVersion, STRUCTURED_COMPACTION_V2_SCHEMA_VERSION);
  assert.match(generated, /```json omk\.structured-compaction\.v2/);
  assert.match(generated, /command-pass/);
  assert.match(generated, /write, patch/);
});

test("typed structured compaction validation rejects contract drift", () => {
  const sample = capsule();
  const typed = buildTypedStructuredCompactionContract(sample);
  const tampered = {
    ...typed,
    routing: { ...typed.routing, provider: "mimo" },
  };
  const text = [
    "```json omk.structured-compaction.v2",
    JSON.stringify(tampered, null, 2),
    "```",
    "## task",
    sample.task,
    "## node routing",
    "provider=mimo; risk=write; sandboxMode=workspace-write",
    "## evidence requirements",
    "command-pass",
    "## safety constraints",
    "preserve safety constraints; evidence required",
    "## capabilities",
    "write, patch",
  ].join("\n");
  const validation = validateStructuredCompaction(text, sample);
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("typed routing provider"));
});

test("structured fallback redacts secret-like graph memory values", () => {
  const sample = capsule({
    graphMemory: [{
      kind: "provider_behavior",
      subject: "auth",
      predicate: "uses",
      object: "API_TOKEN=short-token",
      confidence: 0.9,
      key: "API_TOKEN",
      value: "short-token",
      category: "provider_behavior",
    }],
  });
  const generated = buildStructuredCompactionText(sample, DEFAULT_STRUCTURED_COMPACTION_CONTRACT, { maxTokens: 900 });
  assert.doesNotMatch(generated, /short-token/);
  assert.match(generated, /API_TOKEN=\*\*\*/);
  assert.equal(validateStructuredCompaction(generated, sample).ok, true);
});

test("structured fallback keeps hard contract while token-budgeting optional sections", () => {
  const sample = capsule({
    dependencySummaries: Array.from({ length: 10 }, (_, i) => `dependency-${i} ${"x".repeat(400)}`),
    graphMemory: Array.from({ length: 10 }, (_, i) => ({
      kind: "failure_pattern",
      subject: `fact-${i}`,
      predicate: "says",
      object: "y".repeat(400),
      confidence: 0.8,
      key: `fact-${i}`,
      value: "y".repeat(400),
      category: "failure_pattern",
    })),
  });
  const generated = buildStructuredCompactionText(sample, DEFAULT_STRUCTURED_COMPACTION_CONTRACT, { maxTokens: 360, maxMemoryFacts: 10 });
  assert.match(generated, /## task/);
  assert.match(generated, /## node routing/);
  assert.match(generated, /## evidence requirements/);
  assert.match(generated, /## safety constraints/);
  assert.match(generated, /## capabilities/);
  assert.equal(validateStructuredCompaction(generated, sample).ok, true);
  assert.ok(generated.length < JSON.stringify(sample).length);
});

test("typed contract parser extracts generated v2 contract", () => {
  const sample = capsule();
  const generated = buildStructuredCompactionText(sample);
  const parsed = parseTypedStructuredCompactionContract(generated);
  assert.equal(parsed?.schemaVersion, STRUCTURED_COMPACTION_V2_SCHEMA_VERSION);
  assert.equal(parsed?.routing.provider, "codex");
  assert.equal(parsed?.evidence.required[0].gate, "command-pass");
});
