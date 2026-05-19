/**
 * EvidenceRecorder — persists AttemptRecord + EvidenceResult to JSONL files.
 *
 * Storage structure:
 *   .omk/runs/<runId>/attempts.jsonl   — attempt records
 *   .omk/runs/<runId>/evidence.jsonl   — evidence results (per gate)
 *   .omk/runs/<runId>/context-capsules/<nodeId>-<attemptId>.json
 */

import { appendFileSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import type { AttemptRecord, EvidenceResult } from "./attempt-record.js";
import { redactSecrets } from "../orchestration/state-persister.js";

export interface EvidenceRecorderOptions {
  runsDir?: string;
}

export interface EvidenceRecorder {
  ensureRunDir(runId: string): void;
  recordAttempt(record: AttemptRecord): void;
  recordEvidence(runId: string, nodeId: string, attemptId: string, results: readonly EvidenceResult[]): void;
  saveContextSnapshot(runId: string, nodeId: string, attemptId: string, capsule: unknown): void;
}

export function createEvidenceRecorder(options?: EvidenceRecorderOptions): EvidenceRecorder {
  const runsDir = options?.runsDir ?? ".omk/runs";

  function ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  function appendJsonl(filePath: string, data: unknown): void {
    ensureDir(dirname(filePath));
    appendFileSync(filePath, JSON.stringify(redactSecrets(data)) + "\n", "utf-8");
  }

  function writeJson(filePath: string, data: unknown): void {
    ensureDir(dirname(filePath));
    writeFileSync(filePath, JSON.stringify(redactSecrets(data), null, 2), "utf-8");
  }

  function recordAttempt(record: AttemptRecord): void {
    const dir = join(runsDir, record.runId);
    appendJsonl(join(dir, "attempts.jsonl"), record);
  }

  function ensureRunDir(runId: string): void {
    const dir = join(runsDir, runId);
    ensureDir(dir);
    ensureDir(join(dir, "context-capsules"));
    ensureDir(join(dir, "artifacts"));
    ensureDir(join(dir, "reports"));
  }

  function recordEvidence(
    runId: string,
    nodeId: string,
    attemptId: string,
    results: readonly EvidenceResult[]
  ): void {
    const dir = join(runsDir, runId);
    for (const result of results) {
      appendJsonl(join(dir, "evidence.jsonl"), {
        nodeId,
        attemptId,
        ...result,
        timestamp: new Date().toISOString(),
      });
    }
  }

  function saveContextSnapshot(
    runId: string,
    nodeId: string,
    attemptId: string,
    capsule: unknown
  ): void {
    const dir = join(runsDir, runId, "context-capsules");
    const filePath = join(dir, `${nodeId}-${attemptId}.json`);
    writeJson(filePath, capsule);
  }

  return { ensureRunDir, recordAttempt, recordEvidence, saveContextSnapshot };
}
