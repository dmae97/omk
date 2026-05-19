import { mkdir, readFile, writeFile, rename, unlink } from "fs/promises";
import { dirname, join } from "path";
import type { RunState } from "../contracts/orchestration.js";
import { validateRunId } from "../util/run-store.js";
import { redactSecrets as redactSecretText } from "../mcp/secret-scanner.js";

const SECRET_KEY_EXACT = ["apikey", "token", "password", "secret", "authorization", "bearer"];
const SECRET_KEY_SUFFIXES = ["_api_key", "_token", "_password", "_secret", "_auth", "_bearer"];

function isSecretKey(key: string): boolean {
  const lk = key.toLowerCase();
  return SECRET_KEY_EXACT.includes(lk) ||
         SECRET_KEY_SUFFIXES.some((s) => lk.endsWith(s));
}

export function redactSecrets(obj: unknown): unknown {
  if (typeof obj === "string") return redactSecretText(obj).redacted;
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && isSecretKey(key)) {
      result[key] = "***";
    } else {
      result[key] = redactSecrets(value);
    }
  }
  return result;
}

export interface StatePersister {
  load(runId: string): Promise<RunState | null>;
  save(state: RunState): Promise<void>;
}

export function createStatePersister(basePath: string = ".omk/runs"): StatePersister {
  return {
    async load(runId: string): Promise<RunState | null> {
      const valid = validateRunId(runId);
      const filePath = join(basePath, valid, "state.json");
      try {
        const content = await readFile(filePath, "utf-8");
        const parsed = JSON.parse(content) as RunState;
        return redactSecrets(parsed) as RunState;
      } catch {
        return null;
      }
    },

    async save(state: RunState): Promise<void> {
      const valid = validateRunId(state.runId);
      const filePath = join(basePath, valid, "state.json");
      await mkdir(dirname(filePath), { recursive: true });
      const cloned = JSON.parse(JSON.stringify(state)) as RunState;
      const toSave: RunState = { ...(redactSecrets(cloned) as RunState), schemaVersion: 1 };
      const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      try {
        await writeFile(tempPath, JSON.stringify(toSave, null, 2), "utf-8");
        await rename(tempPath, filePath);
      } catch (err) {
        try { await unlink(tempPath); } catch { /* ignore cleanup error */ }
        throw err;
      }
    },
  };
}
