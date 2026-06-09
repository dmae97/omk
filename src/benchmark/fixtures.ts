/**
 * Benchmark fixtures — synthetic trace generation + recorded trace loader.
 *
 * All synthetic traces are deterministic given a seed.
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  BenchmarkTask,
  BenchmarkTaskCategory,
  BenchmarkFixture,
  BenchmarkAttemptStub,
} from "./contracts.js";

export const DEFAULT_FIXTURE_VERSION = "1.0.0";

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

const CATEGORIES: BenchmarkTaskCategory[] = [
  "read-only-repo-qa",
  "small-bug-fix",
  "failing-test-repair",
  "multi-file-refactor",
  "cli-command-task",
  "dependency-update",
  "merge-conflict-task",
  "security-sensitive-task",
  "provider-failure-fallback",
  "quota-auth-failure-fallback",
];

const RUNTIME_IDS = ["kimi-wire", "kimi-print", "openai-compatible", "deepseek", "local"] as const;

function makeAttemptStub(
  taskId: string,
  category: BenchmarkTaskCategory,
  attemptNumber: number,
  rng: () => number,
  outcomeOverride?: "success" | "failure" | "fallback",
): BenchmarkAttemptStub {
  const runtime = pick([...RUNTIME_IDS], rng);
  const statusBase = outcomeOverride ?? pick(["success", "success", "failure", "fallback"], rng);
  const status = statusBase === "fallback" ? "runtime_failed" : statusBase === "success" ? "success" : "evidence_failed";
  const latencyMs = Math.floor(500 + rng() * 8000);
  const inputTokens = Math.floor(1000 + rng() * 15000);
  const outputTokens = Math.floor(200 + rng() * 5000);
  const costUsd = parseFloat((inputTokens * 0.000002 + outputTokens * 0.000006).toFixed(6));

  const evidenceGates =
    category === "security-sensitive-task"
      ? ["test", "lint", "audit", "review"]
      : category === "cli-command-task"
      ? ["command", "stdout-match"]
      : ["test", "lint", "diff"];

  const evidenceResults = evidenceGates.map((gate) => ({
    gate,
    passed: status === "success" ? true : rng() > 0.3,
  }));

  return {
    attemptId: `${taskId}__${attemptNumber}`,
    runtime,
    model: "default",
    provider: runtime.split("-")[0],
    status,
    latencyMs,
    inputTokensEstimated: inputTokens,
    outputTokensEstimated: outputTokens,
    costUsdEstimated: costUsd,
    evidenceResults,
    changedFiles: category === "read-only-repo-qa" ? [] : [`src/${taskId}.ts`],
    commandsRun: ["npm test", "npm run lint"],
    summary: `${category} attempt ${attemptNumber}`,
    error: status !== "success" ? "simulated failure" : undefined,
  };
}

function makeTask(
  index: number,
  category: BenchmarkTaskCategory,
  seed: number,
  omkVersion: string,
  treeHash: string,
  providerConfigHash: string,
): BenchmarkTask {
  const rng = seededRandom(seed + index * 7919);
  const taskId = `bench-${category}-${String(index).padStart(3, "0")}`;
  const expectedOutcome = pick(["success", "success", "failure", "fallback"], rng) as "success" | "failure" | "fallback";
  const attempts: BenchmarkAttemptStub[] = [];
  const attemptCount = expectedOutcome === "fallback" ? 2 : 1;
  for (let i = 1; i <= attemptCount; i++) {
    attempts.push(makeAttemptStub(taskId, category, i, rng, i === 1 ? undefined : "success"));
  }

  return {
    taskId,
    category,
    intent: category.replace(/-/g, "_"),
    description: `Synthetic ${category} task #${index}`,
    treeHash,
    seed,
    providerConfigHash,
    omkVersion,
    relevantFiles: [`src/${taskId}.ts`],
    expectedOutcome,
    recordedAttempts: attempts,
  };
}

export function generateSyntheticTraces(
  countPerCategory: number,
  seed: number,
  omkVersion: string,
  treeHash: string,
  providerConfigHash: string,
): BenchmarkFixture {
  const tasks: BenchmarkTask[] = [];
  for (const category of CATEGORIES) {
    for (let i = 0; i < countPerCategory; i++) {
      tasks.push(makeTask(i, category, seed, omkVersion, treeHash, providerConfigHash));
    }
  }
  return { tasks, version: DEFAULT_FIXTURE_VERSION };
}

export async function loadRecordedTraces(dir: string): Promise<BenchmarkFixture> {
  const files = (await readdir(dir).catch(() => []))
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(dir, f));

  const tasks: BenchmarkTask[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as BenchmarkTask;
    tasks.push(parsed);
  }
  return { tasks, version: DEFAULT_FIXTURE_VERSION };
}

export function hashConfig(obj: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(obj))
    .digest("hex")
    .slice(0, 16);
}

export function computeTreeHash(): string {
  // In real usage this would be `git rev-parse HEAD`.
  // Benchmark harness supplies the actual commit hash.
  return "unknown";
}
