/**
 * Proof Trust MVP — Algorithm 3
 *
 * Evaluates a proof bundle against a run directory, computing a trust score
 * based on weighted field presence and validity.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ProofTrustMvpEngine {
  evaluate(runDir: string, bundle: unknown): Promise<ProofTrustResult>;
}

export interface ProofTrustResult {
  readonly trustScore: number;
  readonly missingFields: readonly string[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

const EXPECTED_SCHEMA_VERSION = "omk.proof-bundle.v1";

const WEIGHTS = {
  schema: 0.15,
  commands: 0.15,
  stdout: 0.10,
  hashes: 0.15,
  decisions: 0.15,
  evidence: 0.15,
  limitations: 0.05,
  replay: 0.10,
} as const;

type FieldKey = keyof typeof WEIGHTS;

const FIELD_TO_MISSING: Record<FieldKey, string> = {
  schema: "schema",
  commands: "commands",
  stdout: "stdout",
  hashes: "artifact-hashes",
  decisions: "decision-trace",
  evidence: "weak-evidence",
  limitations: "limitations",
  replay: "replay-or-inspect",
};

// ─── Factory ───────────────────────────────────────────────────────────────

export function createProofTrustMvpEngine(
  schemas?: Readonly<Record<string, unknown>>
): ProofTrustMvpEngine {
  return {
    async evaluate(runDir: string, bundle: unknown): Promise<ProofTrustResult> {
      const missingFields: string[] = [];
      const root = process.cwd();

      // ── helpers ─────────────────────────────────────────────────

      function isObject(value: unknown): value is Record<string, unknown> {
        return value !== null && typeof value === "object" && !Array.isArray(value);
      }

      function isNonEmptyString(value: unknown): value is string {
        return typeof value === "string" && value.length > 0;
      }

      function resolveRepoPath(path: string): string | undefined {
        if (!isNonEmptyString(path)) return undefined;
        if (isAbsolute(path)) return undefined;
        if (path.split(/[\\/]+/).includes("..")) return undefined;
        const absolute = join(root, path);
        const back = relative(root, absolute);
        if (back.startsWith("..") || isAbsolute(back)) return undefined;
        return absolute;
      }

      async function digestFile(filePath: string): Promise<string> {
        return createHash("sha256").update(await readFile(filePath)).digest("hex");
      }

      function markMissing(field: FieldKey): void {
        missingFields.push(FIELD_TO_MISSING[field]);
      }

      // ── schema check ────────────────────────────────────────────
      {
        let valid = true;
        if (!isObject(bundle)) {
          valid = false;
        } else if (bundle.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
          valid = false;
        } else {
          const required = [
            "proofId",
            "title",
            "omkVersion",
            "runtimeVersion",
            "commit",
            "runId",
            "providerPolicy",
            "scenario",
            "files",
            "verdict",
            "knownLimitations",
            "checksums",
          ];
          for (const field of required) {
            if (!(field in bundle)) {
              valid = false;
              break;
            }
          }
          if (valid && schemas && EXPECTED_SCHEMA_VERSION in schemas) {
            // Future: JSON Schema validation. MVP checks version only.
          }
        }
        if (!valid) markMissing("schema");
      }

      // ── commands check ──────────────────────────────────────────
      {
        let hasCommands = false;
        if (isObject(bundle) && isObject(bundle.files)) {
          const commandsPath = bundle.files.commands;
          if (isNonEmptyString(commandsPath)) {
            const resolved = resolveRepoPath(commandsPath);
            if (resolved) {
              try {
                const content = await readFile(resolved, "utf8");
                if (content.trim().length > 0) hasCommands = true;
              } catch { /* ignore */ }
            }
          }
        }
        if (!hasCommands) {
          const fallback = join(runDir, "commands.sh");
          if (existsSync(fallback)) {
            try {
              const content = await readFile(fallback, "utf8");
              if (content.trim().length > 0) hasCommands = true;
            } catch { /* ignore */ }
          }
        }
        if (!hasCommands) markMissing("commands");
      }

      // ── stdout check ────────────────────────────────────────────
      {
        let hasStdout = false;
        if (isObject(bundle) && isObject(bundle.files)) {
          const stdoutPath = bundle.files.stdout;
          if (isNonEmptyString(stdoutPath)) {
            const resolved = resolveRepoPath(stdoutPath);
            if (resolved) {
              try {
                const st = await stat(resolved);
                if (st.size > 0) hasStdout = true;
              } catch { /* ignore */ }
            }
          }
        }
        if (!hasStdout) {
          try {
            const entries = await readdir(runDir);
            if (entries.some((e) => e.endsWith(".out"))) hasStdout = true;
          } catch { /* ignore */ }
        }
        if (!hasStdout) markMissing("stdout");
      }

      // ── artifact-hashes check ───────────────────────────────────
      {
        let valid = true;
        if (isObject(bundle) && isObject(bundle.checksums) && isObject(bundle.files)) {
          const checksums = bundle.checksums as Record<string, unknown>;
          const files = bundle.files as Record<string, unknown>;

          for (const [, path] of Object.entries(files)) {
            if (!isNonEmptyString(path)) continue;
            const resolved = resolveRepoPath(path);
            if (!resolved || !existsSync(resolved)) {
              valid = false;
              break;
            }
            const expected = checksums[path];
            if (!isNonEmptyString(expected)) {
              valid = false;
              break;
            }
            try {
              const actual = await digestFile(resolved);
              if (actual !== expected) {
                valid = false;
                break;
              }
            } catch {
              valid = false;
              break;
            }
          }

          if (valid) {
            const fileValues = Object.values(files).filter((v): v is string => isNonEmptyString(v));
            for (const checksumPath of Object.keys(checksums)) {
              if (!fileValues.includes(checksumPath)) {
                valid = false;
                break;
              }
            }
          }
        } else {
          valid = false;
        }
        if (!valid) markMissing("hashes");
      }

      // ── decision-trace check ────────────────────────────────────
      {
        let complete = false;
        if (isObject(bundle) && isObject(bundle.files)) {
          const decisionsPath = bundle.files.decisionsJsonl;
          if (isNonEmptyString(decisionsPath)) {
            const resolved = resolveRepoPath(decisionsPath);
            if (resolved && existsSync(resolved)) {
              try {
                const content = await readFile(resolved, "utf8");
                const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
                if (lines.length > 0) {
                  complete = lines.every((line) => {
                    try {
                      const parsed = JSON.parse(line) as unknown;
                      return isObject(parsed) && parsed.schemaVersion === "omk.decision.v1";
                    } catch {
                      return false;
                    }
                  });
                }
              } catch { /* ignore */ }
            }
          }
        }
        if (!complete) {
          const fallback = join(runDir, "decisions.jsonl");
          if (existsSync(fallback)) {
            try {
              const content = await readFile(fallback, "utf8");
              const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
              if (lines.length > 0) {
                complete = lines.every((line) => {
                  try {
                    const parsed = JSON.parse(line) as unknown;
                    return isObject(parsed) && parsed.schemaVersion === "omk.decision.v1";
                  } catch {
                    return false;
                  }
                });
              }
            } catch { /* ignore */ }
          }
        }
        if (!complete) markMissing("decisions");
      }

      // ── evidence check ──────────────────────────────────────────
      {
        const records: Array<Record<string, unknown>> = [];
        if (isObject(bundle) && isObject(bundle.files)) {
          const evidencePath = bundle.files.evidenceJsonl;
          if (isNonEmptyString(evidencePath)) {
            const resolved = resolveRepoPath(evidencePath);
            if (resolved && existsSync(resolved)) {
              try {
                const content = await readFile(resolved, "utf8");
                const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
                for (const line of lines) {
                  try {
                    const parsed = JSON.parse(line) as unknown;
                    if (isObject(parsed)) records.push(parsed);
                  } catch { /* ignore */ }
                }
              } catch { /* ignore */ }
            }
          }
        }
        if (records.length === 0) {
          const fallback = join(runDir, "evidence.jsonl");
          if (existsSync(fallback)) {
            try {
              const content = await readFile(fallback, "utf8");
              const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
              for (const line of lines) {
                try {
                  const parsed = JSON.parse(line) as unknown;
                  if (isObject(parsed)) records.push(parsed);
                } catch { /* ignore */ }
              }
            } catch { /* ignore */ }
          }
        }

        let avg: number;
        if (records.length === 0) {
          avg = 0;
        } else {
          const passCount = records.filter((r) => r.status === "passed").length;
          avg = passCount / records.length;
        }
        if (avg < 0.75) markMissing("evidence");
      }

      // ── limitations check ───────────────────────────────────────
      {
        let hasLimitations = false;
        if (isObject(bundle) && isObject(bundle.files)) {
          const limitationsPath = bundle.files.limitations;
          if (isNonEmptyString(limitationsPath)) {
            const resolved = resolveRepoPath(limitationsPath);
            if (resolved) {
              try {
                const content = await readFile(resolved, "utf8");
                if (content.trim().length > 0) hasLimitations = true;
              } catch { /* ignore */ }
            }
          }
        }
        if (!hasLimitations) {
          const fallback = join(runDir, "limitations.md");
          if (existsSync(fallback)) {
            try {
              const content = await readFile(fallback, "utf8");
              if (content.trim().length > 0) hasLimitations = true;
            } catch { /* ignore */ }
          }
        }
        if (!hasLimitations) markMissing("limitations");
      }

      // ── replay-or-inspect check ─────────────────────────────────
      {
        let hasReplayOrInspect = false;
        if (isObject(bundle) && isObject(bundle.files)) {
          const replayPath = bundle.files.replay;
          const inspectPath = bundle.files.inspectJson;
          for (const p of [replayPath, inspectPath]) {
            if (isNonEmptyString(p)) {
              const resolved = resolveRepoPath(p);
              if (resolved && existsSync(resolved)) {
                hasReplayOrInspect = true;
                break;
              }
            }
          }
        }
        if (!hasReplayOrInspect) {
          if (existsSync(join(runDir, "replay.json")) || existsSync(join(runDir, "inspect.json"))) {
            hasReplayOrInspect = true;
          }
        }
        if (!hasReplayOrInspect) markMissing("replay");
      }

      // ── compute trust score ─────────────────────────────────────
      const missingSet = new Set(missingFields);
      let trustScore = 0;
      for (const [key, weight] of Object.entries(WEIGHTS) as Array<[FieldKey, number]>) {
        if (!missingSet.has(FIELD_TO_MISSING[key])) {
          trustScore += weight;
        }
      }

      return {
        trustScore: Math.round(trustScore * 100) / 100,
        missingFields: Object.freeze(missingFields),
      };
    },
  };
}
