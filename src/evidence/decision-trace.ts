/**
 * DecisionTraceStore — persists policy decisions for forensic replay.
 *
 * Storage:
 *   .omk/runs/<runId>/decisions.jsonl   — DecisionTraceEntry lines
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import type { DecisionTraceEntry } from "../contracts/replay.js";

export interface DecisionTraceStore {
  record(runId: string, entry: Omit<DecisionTraceEntry, "at"> & Partial<Pick<DecisionTraceEntry, "at">>): void;
  load(runId: string): DecisionTraceEntry[];
  loadForNode(runId: string, nodeId: string): DecisionTraceEntry[];
  loadForAttempt(runId: string, attemptId: string): DecisionTraceEntry[];
}

export function createDecisionTraceStore(runsDir: string = ".omk/runs"): DecisionTraceStore {
  function ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  function decisionsPath(runId: string): string {
    return join(runsDir, runId, "decisions.jsonl");
  }

  function record(
    runId: string,
    entry: Omit<DecisionTraceEntry, "at"> & Partial<Pick<DecisionTraceEntry, "at">>
  ): void {
    const full: DecisionTraceEntry = {
      ...entry,
      at: entry.at ?? new Date().toISOString(),
    };
    const path = decisionsPath(runId);
    ensureDir(dirname(path));
    const MAX_DECISION_TRACE_SIZE = 50 * 1024 * 1024;
    if (existsSync(path)) {
      try {
        const stats = statSync(path);
        if (stats.size > MAX_DECISION_TRACE_SIZE) return;
      } catch { /* ignore stat errors */ }
    }
    appendFileSync(path, JSON.stringify(full) + "\n", "utf-8");
  }

  function load(runId: string): DecisionTraceEntry[] {
    const path = decisionsPath(runId);
    if (!existsSync(path)) return [];
    const content = readFileSync(path, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)
      .map((line) => JSON.parse(line) as DecisionTraceEntry);
  }

  function loadForNode(runId: string, nodeId: string): DecisionTraceEntry[] {
    return load(runId).filter((d) => d.nodeId === nodeId);
  }

  function loadForAttempt(runId: string, attemptId: string): DecisionTraceEntry[] {
    return load(runId).filter((d) => d.attemptId === attemptId);
  }

  return { record, load, loadForNode, loadForAttempt };
}
