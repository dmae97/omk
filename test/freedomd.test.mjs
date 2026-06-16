import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileFreedomdPolicy, isFreedomdEnabled, explainFreedomdPolicy } from "../dist/runtime/freedomd-policy.js";
import {
  assessJurisdictionRisk,
  assessRetentionRisk,
  assessCutoffRisk,
  assessPortability,
  computeProviderSovereigntyScore,
  buildProviderSovereigntyProfiles,
} from "../dist/runtime/provider-sovereignty.js";
import { evaluateDataRetentionGate, classifyDataSensitivity } from "../dist/runtime/data-retention-gate.js";
import {
  createFreedomdRuntimeRouter,
  evaluateTaskSovereignty,
  scoreRuntimesWithSovereignty,
  buildFreedomdDegradedPlan,
} from "../dist/runtime/freedomd-router.js";
import { buildLocalFirstEvidenceEnvelope, hashTaskPrompt } from "../dist/runtime/freedomd-evidence-envelope.js";
import { loadProviderIncidents } from "../dist/runtime/freedomd-incidents.js";
import { requestProviderException } from "../dist/runtime/freedomd-exception.js";
import { LocalGraphMemoryStore } from "../dist/memory/local-graph-memory-store.js";
import { sha256Hex } from "../dist/util/hash.js";

function fakeRuntime(id, capabilities = {}, options = {}) {
  return {
    id,
    providerId: options.providerId ?? id.split("-")[0],
    runtimeMode: options.runtimeMode ?? (id.split("-").slice(1).join("-") || "api"),
    priority: options.priority ?? 60,
    capabilities: { read: true, review: true, write: false, patch: false, shell: false, ...capabilities },
    supports: options.supports ?? (() => true),
    async runNode() {
      return { success: true, exitCode: 0, stdout: id, stderr: "", metadata: {} };
    },
    async execute() {
      return { output: id, exitCode: 0, metadata: {} };
    },
  };
}

function fakeTask(overrides = {}) {
  return {
    prompt: "implement a change",
    context: {
      runId: "freedomd-test-run",
      nodeId: "coder-node",
      role: "coder",
      goal: "provider-neutral routing",
      system: "",
      files: [],
      memory: [],
      cwd: process.cwd(),
    },
    tools: { available: [] },
    providerPolicy: { strategy: "priority-first", preferredProviders: [], fallbackChain: [] },
    capabilities: { read: true, write: true, shell: false, patch: true, review: false, merge: false },
    safety: { risk: "write", approvalPolicy: "auto", sandboxMode: "read-only", evidenceRequired: false, authorityMode: "scoped" },
    ...overrides,
  };
}

function fakeCapsule(task) {
  return {
    runId: task.context.runId,
    nodeId: task.context.nodeId,
    goal: task.context.goal,
    system: task.context.system,
    task: task.prompt,
    dependencySummaries: [],
    relevantFiles: [],
    graphMemory: [],
    priorAttempts: [],
    evidenceRequirements: [],
    budget: { maxInputTokens: 8192, reservedOutputTokens: 4096, maxFileTokens: 4096, maxToolResultTokens: 2048, maxMemoryFacts: 10, compression: "lossless-ish" },
    node: {
      id: task.context.nodeId,
      role: task.context.role,
      name: task.context.nodeId,
      dependsOn: [],
      status: "running",
      retries: 0,
      maxRetries: 1,
      routing: { readOnly: !(task.capabilities.write || task.capabilities.shell) },
    },
  };
}

describe("freedomd policy compiler", () => {
  const originalEnv = { ...process.env };

  after(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
  });

  it("defaults to off", () => {
    const policy = compileFreedomdPolicy({ env: {} });
    assert.equal(policy.mode, "off");
    assert.equal(isFreedomdEnabled(policy), false);
  });

  it("reads OMK_FREEDOMD_MODE from env", () => {
    const policy = compileFreedomdPolicy({ env: { OMK_FREEDOMD_MODE: "strict" } });
    assert.equal(policy.mode, "strict");
    assert.equal(policy.preferLocal, true);
    assert.equal(policy.allowExportRestrictedProvider, false);
    assert.equal(policy.requireLocalEvidenceEnvelope, true);
    assert.equal(policy.maxRetentionDays, 0);
  });

  it("task flags override env", () => {
    const policy = compileFreedomdPolicy({ env: { OMK_FREEDOMD_MODE: "off" }, taskFlags: { mode: "balanced" } });
    assert.equal(policy.mode, "balanced");
  });

  it("explain policy returns key fields", () => {
    const text = explainFreedomdPolicy(compileFreedomdPolicy({ env: { OMK_FREEDOMD_MODE: "strict" } }));
    assert.match(text, /mode=strict/);
    assert.match(text, /preferLocal=true/);
  });
});

describe("provider sovereignty score", () => {
  it("local runtime scores highest", () => {
    const runtime = fakeRuntime("local-llm-api", { read: true, review: true }, { providerId: "local-llm", runtimeMode: "api", priority: 50 });
    const task = fakeTask();
    const profile = buildProviderSovereigntyProfiles()["local-llm"];
    const result = computeProviderSovereigntyScore(runtime, task, { profile, localAvailable: true });
    assert.ok(result.score >= 0.9, `expected high local score, got ${result.score}`);
    assert.equal(result.diagnostics.jurisdictionRisk, 0);
    assert.equal(result.diagnostics.retentionRisk, 0);
  });

  it("export-control incident raises jurisdiction risk", () => {
    const runtime = fakeRuntime("kimi-api", { read: true, review: true }, { providerId: "kimi", runtimeMode: "api" });
    const task = fakeTask();
    const profile = buildProviderSovereigntyProfiles()["kimi"];
    const incident = { providerId: "kimi", kind: "export-control", severity: "block", reason: "Fable5", updatedAt: new Date().toISOString() };
    const result = computeProviderSovereigntyScore(runtime, task, { profile, incidents: [incident] });
    assert.ok(result.diagnostics.jurisdictionRisk >= 0.7, `expected high jurisdiction risk, got ${result.diagnostics.jurisdictionRisk}`);
  });

  it("retention risk grows with retention days and training use", () => {
    const risk = assessRetentionRisk({ retentionDays: 365, zeroDataRetention: false, trainingUse: true });
    assert.ok(risk >= 0.7, `expected high retention risk, got ${risk}`);
  });

  it("cutoff risk is bounded", () => {
    const risk = assessCutoffRisk({ policyInstabilityScore: 1, exportControlExposure: 1, accountDependency: 1 });
    assert.equal(risk, 1);
  });

  it("portability rewards open contracts", () => {
    const score = assessPortability({ supportsOpenApiCompat: true, supportsToolContract: true, supportsEvidenceReturn: true });
    assert.ok(score >= 0.9);
  });
});

describe("data retention gate", () => {
  it("blocks secret-like prompts", () => {
    const runtime = fakeRuntime("kimi-api", {}, { providerId: "kimi", runtimeMode: "api" });
    const task = fakeTask({ prompt: "API_KEY=sk-abc123 implement the fix" });
    const profile = buildProviderSovereigntyProfiles()["kimi"];
    const result = evaluateDataRetentionGate({ task, runtime, providerProfile: profile, orgMaxRetentionDays: 30, allowRedaction: false });
    assert.equal(result.decision, "block");
    assert.equal(result.sensitivity.containsSecret, true);
  });

  it("downgrades customer data without redaction", () => {
    const runtime = fakeRuntime("kimi-api", {}, { providerId: "kimi", runtimeMode: "api" });
    const task = fakeTask({ prompt: "analyze customer email list" });
    const profile = buildProviderSovereigntyProfiles()["kimi"];
    const result = evaluateDataRetentionGate({ task, runtime, providerProfile: profile, orgMaxRetentionDays: 30, allowRedaction: false });
    assert.equal(result.decision, "downgrade");
  });

  it("blocks provider exceeding retention policy", () => {
    const runtime = fakeRuntime("kimi-api", {}, { providerId: "kimi", runtimeMode: "api" });
    const task = fakeTask();
    const profile = buildProviderSovereigntyProfiles()["kimi"];
    const result = evaluateDataRetentionGate({ task, runtime, providerProfile: profile, orgMaxRetentionDays: 7, allowRedaction: false });
    assert.equal(result.decision, "block");
    assert.match(result.reason, /exceeds policy/);
  });
});

describe("freedomd router", () => {
  it("routes to local-llm in strict mode even with lower priority", async () => {
    const router = await createFreedomdRuntimeRouter({
      freedomdMode: "strict",
      runtimes: [
        fakeRuntime("kimi-api", { read: true, review: true }, { providerId: "kimi", priority: 100 }),
        fakeRuntime("local-llm-api", { read: true, review: true, write: true, patch: true }, { providerId: "local-llm", priority: 10 }),
      ],
    });
    const task = fakeTask();
    const route = await router.freedomdRoute(task, fakeCapsule(task));
    assert.equal(route.selectedRuntime?.id, "local-llm-api");
    assert.ok(route.diagnostics.includes("local-llm-api"));
  });

  it("blocks export-restricted provider and degrades", async () => {
    const router = await createFreedomdRuntimeRouter({
      freedomdMode: "balanced",
      runtimes: [
        fakeRuntime("kimi-api", { read: true, review: true }, { providerId: "kimi", priority: 100 }),
      ],
      incidents: [
        { providerId: "kimi", kind: "export-control", severity: "block", reason: "Fable5", updatedAt: new Date().toISOString() },
      ],
    });
    const task = fakeTask();
    const route = await router.freedomdRoute(task, fakeCapsule(task));
    assert.equal(route.selectedRuntime, undefined);
    assert.equal(route.degradedPlan?.mode, "blocked");
    assert.equal(route.sovereignty.jurisdictionDecision, "block");
  });

  it("selects cloud runtime in off mode", async () => {
    const router = await createFreedomdRuntimeRouter({
      freedomdMode: "off",
      runtimes: [
        fakeRuntime("kimi-api", { read: true, review: true }, { providerId: "kimi", priority: 100 }),
        fakeRuntime("local-llm-api", { read: true, review: true }, { providerId: "local-llm", priority: 10 }),
      ],
    });
    const task = fakeTask();
    const route = await router.freedomdRoute(task, fakeCapsule(task));
    assert.equal(route.selectedRuntime?.id, "kimi-api");
  });

  it("executes selected runtime and persists evidence envelope", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "omk-freedomd-"));
    const store = await LocalGraphMemoryStore.create({ projectRoot: tmp, sessionId: "freedomd-test" });
    const router = await createFreedomdRuntimeRouter({
      freedomdMode: "balanced",
      runtimes: [
        fakeRuntime("codex-cli", { read: true, write: true, shell: true, patch: true }, { providerId: "codex", runtimeMode: "cli", priority: 100 }),
      ],
      graphStore: store ?? undefined,
      projectRoot: tmp,
    });
    const task = fakeTask();
    const result = await router.executeTask(task, fakeCapsule(task), new AbortController().signal);
    assert.equal(result.success, true);
    assert.equal(result.metadata.selectedRuntime, "codex-cli");
    assert.ok(result.metadata.freedomdEvidenceEnvelope);
    const envelopeRaw = await readFile(result.metadata.freedomdEvidenceEnvelope, "utf-8");
    const envelope = JSON.parse(envelopeRaw);
    assert.equal(envelope.schemaVersion, "omk.freedomd.evidence-envelope.v1");
    assert.equal(envelope.providerId, "codex");
    assert.equal(envelope.sovereignty.mode, "freedomd");
    await rm(tmp, { recursive: true, force: true });
  });
});

describe("freedomd evidence envelope", () => {
  it("hashes task prompt deterministically", () => {
    assert.equal(hashTaskPrompt("hello"), hashTaskPrompt("hello"));
    assert.notEqual(hashTaskPrompt("hello"), hashTaskPrompt("world"));
  });

  it("persists envelope artifacts with sha256", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "omk-freedomd-envelope-"));
    const runtime = fakeRuntime("local-llm-api", {}, { providerId: "local-llm" });
    const task = fakeTask();
    const sovereignty = {
      mode: "freedomd",
      dataBoundary: "internal",
      retentionDecision: "allow",
      jurisdictionDecision: "allow",
      providerCutoffRisk: 0,
      localFallbackAvailable: true,
      reason: "test",
    };
    const result = await buildLocalFirstEvidenceEnvelope({
      task,
      selectedRuntime: runtime,
      runContext: { runId: "env-run", nodeId: "env-node", projectRoot: tmp },
      providerResponse: { success: true, exitCode: 0, stdout: "ok", stderr: "" },
      sovereignty,
    });
    assert.equal(result.schemaVersion, "omk.freedomd.evidence-envelope.v1");
    assert.equal(result.localArtifacts.length, 2);
    for (const artifact of result.localArtifacts) {
      assert.equal(artifact.sha256, sha256Hex(await readFile(artifact.path, "utf-8")));
    }
    await rm(tmp, { recursive: true, force: true });
  });
});

describe("freedomd incident monitor", () => {
  it("loads incidents from env JSON", async () => {
    const incidents = await loadProviderIncidents({
      projectRoot: process.cwd(),
      env: {
        OMK_PROVIDER_INCIDENTS: JSON.stringify([
          { providerId: "anthropic", kind: "export-control", severity: "block", reason: "Fable5", updatedAt: new Date().toISOString() },
        ]),
      },
    });
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].providerId, "anthropic");
    assert.equal(incidents[0].severity, "block");
  });

  it("returns empty when no sources are configured", async () => {
    const incidents = await loadProviderIncidents({ projectRoot: process.cwd(), env: {} });
    assert.equal(incidents.length, 0);
  });

  it("fetches public feed URLs and falls back to local overrides", async () => {
    const feed = JSON.stringify({
      incidents: [
        { providerId: "anthropic", kind: "export-control", severity: "warn", reason: "feed", updatedAt: new Date().toISOString() },
      ],
    });
    const fetcher = async (url) => {
      assert.equal(url, "https://example.com/freedomd-feed.json");
      return { ok: true, text: async () => feed };
    };
    const incidents = await loadProviderIncidents({
      projectRoot: process.cwd(),
      env: {},
      feedUrls: ["https://example.com/freedomd-feed.json"],
      fetch: fetcher,
    });
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].severity, "warn");
  });

  it("prefers local override over feed on severity", async () => {
    const feed = JSON.stringify({
      incidents: [
        { providerId: "anthropic", kind: "export-control", severity: "warn", reason: "feed", updatedAt: new Date().toISOString() },
      ],
    });
    const incidents = await loadProviderIncidents({
      projectRoot: process.cwd(),
      env: {
        OMK_PROVIDER_INCIDENTS: JSON.stringify([
          { providerId: "anthropic", kind: "export-control", severity: "block", reason: "local", updatedAt: new Date().toISOString() },
        ]),
      },
      feedUrls: ["https://example.com/freedomd-feed.json"],
      fetch: async () => ({ ok: true, text: async () => feed }),
    });
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].severity, "block");
    assert.equal(incidents[0].reason, "local");
  });

  it("ignores failing feed URLs", async () => {
    const incidents = await loadProviderIncidents({
      projectRoot: process.cwd(),
      env: {},
      feedUrls: ["https://example.com/bad"],
      fetch: async () => ({ ok: false, text: async () => "" }),
    });
    assert.equal(incidents.length, 0);
  });
});

describe("freedomd provider exception approval", () => {
  it("denies in non-interactive mode", async () => {
    const result = await requestProviderException(
      {
        providerId: "anthropic",
        blockedReason: "export-control",
        retentionDays: 30,
        jurisdictionRisk: 0.8,
        localFallbackAvailable: false,
        taskSensitivity: "internal",
      },
      { runId: "exc-run", nodeId: "exc-node", isTty: false },
    );
    assert.equal(result.decision, "deny");
    assert.match(result.reason, /non-interactive/);
  });

  it("records allow-once artifact", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "omk-freedomd-exc-"));
    const result = await requestProviderException(
      {
        providerId: "anthropic",
        blockedReason: "export-control",
        retentionDays: 30,
        jurisdictionRisk: 0.8,
        localFallbackAvailable: false,
        taskSensitivity: "internal",
      },
      {
        runId: "exc-run",
        nodeId: "exc-node",
        projectRoot: tmp,
        isTty: true,
        promptUser: async () => "allow once",
      },
    );
    assert.equal(result.decision, "once");
    assert.ok(result.artifactPath);
    const artifact = await readFile(result.artifactPath, "utf-8");
    assert.match(artifact, /"scope":\s*"once"/);
    await rm(tmp, { recursive: true, force: true });
  });
});

describe("freedomd graph ontology", () => {
  it("materializes sovereignty decision and evidence envelope nodes", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "omk-freedomd-graph-"));
    const store = await LocalGraphMemoryStore.create({ projectRoot: tmp, sessionId: "freedomd-graph-test" });
    assert.ok(store);
    await store.materializeFreedomdSovereignty({
      runId: "graph-run",
      nodeId: "graph-node",
      providerId: "kimi",
      runtimeMode: "api",
      sovereignty: {
        mode: "freedomd",
        dataBoundary: "internal",
        retentionDecision: "block",
        jurisdictionDecision: "allow",
        providerCutoffRisk: 0.8,
        localFallbackAvailable: false,
        reason: "retention policy",
      },
      degradedMode: "read-only-local-review",
      incident: { kind: "retention", severity: "warn", reason: "retention days exceeded" },
    });
    await store.materializeFreedomdEvidenceEnvelope({
      runId: "graph-run",
      nodeId: "graph-node",
      envelopePath: ".omk/runs/graph-run/freedomd/graph-node-evidence-envelope.json",
      sha256: "abc",
      sizeBytes: 123,
      exists: true,
    });

    const state = JSON.parse(await readFile(join(tmp, ".omk", "memory", "graph-state.json"), "utf-8"));
    const types = new Set(state.nodes.map((n) => n.type));
    assert.ok(types.has("SovereigntyDecision"));
    assert.ok(types.has("DegradedPlan"));
    assert.ok(types.has("ProviderIncident"));
    assert.ok(types.has("EvidenceEnvelope"));
    assert.ok(types.has("Artifact"));
    assert.ok(state.ontology.relationTypes.includes("HAS_SOVEREIGNTY_DECISION"));
    assert.ok(state.ontology.relationTypes.includes("DEGRADED_TO"));
    assert.ok(state.ontology.relationTypes.includes("AFFECTED_BY_INCIDENT"));
    assert.ok(state.ontology.relationTypes.includes("EVIDENCE_ENVELOPE_STORED_AT"));
    await rm(tmp, { recursive: true, force: true });
  });
});
