#!/usr/bin/env node
/**
 * Benchmark runner CLI for OMK control plane.
 *
 * Usage:
 *   node scripts/run-benchmark.mjs --shadow [--categories cat1,cat2] [--summary-json path]
 *   node scripts/run-benchmark.mjs --live  --tasks-dir path/to/fixtures
 *
 * Exits 0 if quality gates pass, 1 otherwise.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const DEFAULT_OUTPUT_DIR = ".omk/benchmarks";
const DEFAULT_TASKS_DIR = "test/benchmark-fixtures";
const GATES = {
  minSolveRate: 0.70,
  maxFalseDoneRate: 0.10,
  maxRouterRegretMean: 0.20,
};

function parseArgs(argv) {
  const options = {
    mode: "shadow",
    categories: undefined,
    summaryPath: undefined,
    tasksDir: DEFAULT_TASKS_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    runId: `bench-${Date.now()}`,
    pinTreeHash: undefined,
    pinSeed: undefined,
    pinProviderConfigHash: undefined,
    maxConcurrency: 1,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--shadow") {
      options.mode = "shadow";
    } else if (arg === "--live") {
      options.mode = "live";
    } else if (arg === "--categories") {
      const value = argv[++i];
      if (!value) { console.error("--categories requires a value"); process.exit(1); }
      options.categories = value.split(",").map((s) => s.trim());
    } else if (arg.startsWith("--categories=")) {
      options.categories = arg.slice("--categories=".length).split(",").map((s) => s.trim());
    } else if (arg === "--summary-json" || arg === "--json-summary") {
      options.summaryPath = argv[++i] ?? join(DEFAULT_OUTPUT_DIR, `${options.runId}.json`);
    } else if (arg.startsWith("--summary-json=")) {
      options.summaryPath = arg.slice("--summary-json=".length);
    } else if (arg === "--tasks-dir") {
      options.tasksDir = argv[++i] ?? DEFAULT_TASKS_DIR;
    } else if (arg.startsWith("--tasks-dir=")) {
      options.tasksDir = arg.slice("--tasks-dir=".length);
    } else if (arg === "--output-dir") {
      options.outputDir = argv[++i] ?? DEFAULT_OUTPUT_DIR;
    } else if (arg.startsWith("--output-dir=")) {
      options.outputDir = arg.slice("--output-dir=".length);
    } else if (arg === "--run-id") {
      options.runId = argv[++i] ?? `bench-${Date.now()}`;
    } else if (arg.startsWith("--run-id=")) {
      options.runId = arg.slice("--run-id=".length);
    } else if (arg === "--pin-tree-hash") {
      options.pinTreeHash = argv[++i];
    } else if (arg === "--pin-seed") {
      options.pinSeed = parseInt(argv[++i] ?? "42", 10);
    } else if (arg === "--pin-provider-config-hash") {
      options.pinProviderConfigHash = argv[++i];
    } else if (arg === "--max-concurrency") {
      options.maxConcurrency = parseInt(argv[++i] ?? "1", 10);
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv);

  await mkdir(options.outputDir, { recursive: true });

  const { runBenchmarkSuite } = await import(
    new URL("../dist/benchmark/harness.js", import.meta.url).href
  );

  // Build a minimal runtime inventory for shadow mode
  const runtimes = [
    {
      id: "kimi-wire",
      priority: 80,
      capabilities: {
        read: true, write: true, shell: true, patch: true,
        review: true, merge: false, vision: false, mcp: true,
        toolCalling: true, supportsToolCalling: true,
        streaming: true, supportsStreaming: true,
        maxTokens: 200_000, maxContextTokens: 200_000,
      },
      supports() { return true; },
      async runNode() { return { success: true, stdout: "", stderr: "" }; },
    },
    {
      id: "deepseek",
      priority: 70,
      capabilities: {
        read: true, write: true, shell: true, patch: true,
        review: true, merge: false, vision: false, mcp: true,
        toolCalling: true, supportsToolCalling: true,
        streaming: true, supportsStreaming: true,
        maxTokens: 64_000, maxContextTokens: 64_000,
      },
      supports() { return true; },
      async runNode() { return { success: true, stdout: "", stderr: "" }; },
    },
    {
      id: "openai-compatible",
      priority: 60,
      capabilities: {
        read: true, write: true, shell: false, patch: true,
        review: true, merge: false, vision: true, mcp: false,
        toolCalling: true, supportsToolCalling: true,
        streaming: true, supportsStreaming: true,
        maxTokens: 128_000, maxContextTokens: 128_000,
      },
      supports() { return true; },
      async runNode() { return { success: true, stdout: "", stderr: "" }; },
    },
    {
      id: "local",
      priority: 30,
      capabilities: {
        read: true, write: false, shell: false, patch: false,
        review: false, merge: false, vision: false, mcp: false,
        toolCalling: false, supportsToolCalling: false,
        streaming: false, supportsStreaming: false,
        maxTokens: 8_000, maxContextTokens: 8_000,
      },
      supports() { return true; },
      async runNode() { return { success: true, stdout: "", stderr: "" }; },
    },
  ];

  const summary = await runBenchmarkSuite({
    config: {
      mode: options.mode,
      tasksDir: options.tasksDir,
      outputDir: options.outputDir,
      runId: options.runId,
      maxConcurrency: options.maxConcurrency,
      pinTreeHash: options.pinTreeHash,
      pinSeed: options.pinSeed,
      pinProviderConfigHash: options.pinProviderConfigHash,
      categories: options.categories,
    },
    runtimes,
  });

  const outPath = options.summaryPath ?? join(options.outputDir, `${options.runId}.json`);
  await writeFile(outPath, JSON.stringify(summary, null, 2), "utf-8");

  console.log(`\n==============================`);
  console.log(`Benchmark run: ${summary.runId}`);
  console.log(`Mode:          ${summary.mode}`);
  console.log(`Tasks:         ${summary.totalTasks}`);
  console.log(`Solved:        ${summary.solvedCount} (${(summary.solveRate * 100).toFixed(1)}%)`);
  console.log(`ETS mean:      ${summary.evidenceTrustScoreMean.toFixed(3)}`);
  console.log(`False done:    ${(summary.falseDoneRate * 100).toFixed(1)}%`);
  console.log(`Fallback OK:   ${(summary.fallbackSuccessRate * 100).toFixed(1)}%`);
  console.log(`Regret mean:   ${summary.routerRegretMean.toFixed(4)}`);
  console.log(`Cost/solved:   $${summary.costPerSolvedTask.toFixed(4)}`);
  console.log(`P95 latency:   ${summary.p95LatencyMs}ms`);
  console.log(`Rollback rate: ${(summary.rollbackRate * 100).toFixed(1)}%`);
  console.log(`Sandbox viol:  ${summary.sandboxViolationCount}`);
  console.log(`==============================`);

  let gateOk = true;
  if (summary.solveRate < GATES.minSolveRate) {
    console.error(`\n❌ Gate failed: solveRate ${summary.solveRate.toFixed(2)} < ${GATES.minSolveRate}`);
    gateOk = false;
  }
  if (summary.falseDoneRate > GATES.maxFalseDoneRate) {
    console.error(`\n❌ Gate failed: falseDoneRate ${summary.falseDoneRate.toFixed(2)} > ${GATES.maxFalseDoneRate}`);
    gateOk = false;
  }
  if (summary.routerRegretMean > GATES.maxRouterRegretMean) {
    console.error(`\n❌ Gate failed: routerRegretMean ${summary.routerRegretMean.toFixed(4)} > ${GATES.maxRouterRegretMean}`);
    gateOk = false;
  }

  if (gateOk) {
    console.log(`\n✅ All benchmark gates passed`);
    process.exit(0);
  } else {
    console.error(`\nBenchmark gates failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
