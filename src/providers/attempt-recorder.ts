import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { ProviderAttemptRecord } from "./provider.js";
import type { AttemptRecord } from "../evidence/attempt-record.js";
import { redactSecrets } from "../orchestration/state-persister.js";

export interface AttemptRecorderOptions {
  runsDir?: string;
}

export function createAttemptRecorder(options?: AttemptRecorderOptions) {
  const runsDir = options?.runsDir ?? ".omk/runs";

  function record(attempt: ProviderAttemptRecord | AttemptRecord): void {
    const dir = join(runsDir, attempt.runId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const filePath = join(dir, "attempts.jsonl");
    const line = JSON.stringify(redactSecrets(attempt)) + "\n";
    appendFileSync(filePath, line, "utf-8");
  }

  function startAttempt(
    runId: string,
    nodeId: string,
    attempt: number,
    providerId: string
  ): ProviderAttemptRecord {
    return {
      runId,
      nodeId,
      attempt,
      providerId,
      startedAt: new Date().toISOString(),
      success: false,
    };
  }

  function completeAttempt(
    record: ProviderAttemptRecord,
    success: boolean,
    exitCode?: number,
    fallbackFrom?: string,
    fallbackReason?: string
  ): ProviderAttemptRecord {
    const completed = {
      ...record,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - new Date(record.startedAt).getTime(),
      success,
      exitCode,
      fallbackFrom,
      fallbackReason,
    };
    return completed;
  }

  return { record, startAttempt, completeAttempt };
}
