/**
 * Evidence gate checking implementation.
 *
 * Evaluates a list of evidence gates (file-exists, command-pass,
 * diff-nonempty, summary-present) and returns structured results.
 */

import { access, realpath } from "fs/promises";
import { constants } from "fs";
import { isAbsolute, relative, resolve } from "path";
import type { DagNodeEvidence } from "./dag.js";
import { runShell } from "../util/shell.js";
import { createDecisionTraceStore } from "../evidence/decision-trace.js";
import { compressDiagnostic, tailLines, redactDiagnosticText } from "./diagnostics.js";
import type { EvidenceFailureKind } from "./diagnostics.js";

/** Allowlist pattern reused from quality-gate.ts */
const SCRIPT_NAME_PATTERN = /^[A-Za-z0-9:_-]+$/;
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

export const SUMMARY_ALIASES = [
  "## Summary",
  "## Evidence",
  "## Results",
  "## Output",
  "## Conclusion",
  "## Findings",
  "### Summary",
  "### Evidence",
  "### Results",
  "### Output",
  "### Conclusion",
  "### Findings",
];

export interface EvidenceGate {
  type: "file-exists" | "command-pass" | "diff-nonempty" | "summary-present";
  path?: string;
  command?: string;
  summaryMarker?: string;
  severity?: "required" | "warn";
}

export interface EvidenceCheckContext {
  cwd: string;
  stdout: string;
  nodeId: string;
  runId?: string;
  attemptId?: string;
}

export interface EvidenceResult extends DagNodeEvidence {
  failureKind?: EvidenceFailureKind;
  command?: string;
  exitCode?: number;
  stdoutTail?: string;
  stderrTail?: string;
  evidenceText?: string;
}

function resolveSafeCommand(command: string): { cmd: string; args: string[] } | null {
  const trimmed = command.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1 && SCRIPT_NAME_PATTERN.test(parts[0])) {
    return { cmd: "npm", args: ["run", parts[0]] };
  }
  if (
    parts.length >= 2 &&
    PACKAGE_MANAGERS.has(parts[0]) &&
    parts[1] === "run" &&
    SCRIPT_NAME_PATTERN.test(parts[2] ?? "")
  ) {
    return { cmd: parts[0], args: parts.slice(1) };
  }
  if (
    parts.length >= 2 &&
    PACKAGE_MANAGERS.has(parts[0]) &&
    SCRIPT_NAME_PATTERN.test(parts[1] ?? "")
  ) {
    return { cmd: parts[0], args: ["run", parts[1]] };
  }
  return null;
}

function resolveWorkspacePath(cwd: string, path: string): string | null {
  const root = resolve(cwd);
  const resolvedPath = resolve(root, path);
  const relativePath = relative(root, resolvedPath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return resolvedPath;
  }
  return null;
}

async function resolveWorkspaceRealPath(cwd: string, resolvedPath: string): Promise<string | null> {
  const root = await realpath(resolve(cwd));
  const candidate = await realpath(resolvedPath);
  const relativePath = relative(root, candidate);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return candidate;
  }
  return null;
}

export async function checkEvidenceGates(
  gates: EvidenceGate[],
  context: EvidenceCheckContext
): Promise<{ passed: boolean; evidence: EvidenceResult[]; warnings: EvidenceResult[] }> {
  const evidence: EvidenceResult[] = [];
  const warnings: EvidenceResult[] = [];
  let allPassed = true;

  for (const gate of gates) {
    const result = await checkSingleGate(gate, context);
    const severity = gate.severity ?? "required";

    if (!result.passed && severity === "warn") {
      warnings.push(result);
      evidence.push({
        ...result,
        passed: true,
        message: `(warn-only) ${result.message ?? ""}`,
      });
    } else {
      evidence.push(result);
      if (!result.passed) allPassed = false;
    }
  }

  // Record evidence-gate decision trace
  if (context.runId) {
    const traceStore = createDecisionTraceStore();
    traceStore.record(context.runId, {
      component: "evidence-gate",
      inputSummary: `node=${context.nodeId} gates=${gates.length}`,
      outputDecision: `passed=${allPassed} evidence=${evidence.length} warnings=${warnings.length}`,
      reason: evidence.map((e) => `${e.gate}=${e.passed ? "pass" : "fail"}`).join(", "),
      scores: { passCount: evidence.filter((e) => e.passed).length, failCount: evidence.filter((e) => !e.passed).length },
      nodeId: context.nodeId,
      attemptId: context.attemptId,
    });
  }

  return { passed: allPassed, evidence, warnings };
}

async function checkSingleGate(
  gate: EvidenceGate,
  context: EvidenceCheckContext
): Promise<EvidenceResult> {
  switch (gate.type) {
    case "file-exists": {
      if (!gate.path) {
        return {
          gate: gate.type,
          passed: false,
          failureKind: "missing_file",
          message: `Missing "path" for file-exists gate`,
        };
      }
      const resolvedPath = resolveWorkspacePath(context.cwd, gate.path);
      if (!resolvedPath) {
        return {
          gate: gate.type,
          passed: false,
          failureKind: "policy_violation",
          ref: gate.path,
          message: `Blocked file-exists path outside workspace: ${gate.path}`,
        };
      }
      try {
        await access(resolvedPath, constants.F_OK);
        const realPath = await resolveWorkspaceRealPath(context.cwd, resolvedPath);
        if (!realPath) {
          return {
            gate: gate.type,
            passed: false,
            failureKind: "policy_violation",
            ref: gate.path,
            message: `Blocked file-exists path outside workspace: ${gate.path}`,
          };
        }
        return {
          gate: gate.type,
          passed: true,
          ref: realPath,
          message: `File exists: ${realPath}`,
        };
      } catch {
        return {
          gate: gate.type,
          passed: false,
          failureKind: "missing_file",
          ref: resolvedPath,
          message: `File does not exist: ${resolvedPath}`,
        };
      }
    }

    case "command-pass": {
      if (!gate.command) {
        return {
          gate: gate.type,
          passed: false,
          failureKind: "policy_violation",
          message: `Missing "command" for command-pass gate`,
        };
      }
      const resolved = resolveSafeCommand(gate.command);
      if (!resolved) {
        return {
          gate: gate.type,
          passed: false,
          failureKind: "policy_violation",
          ref: gate.command,
          message: `Blocked unsafe command: ${gate.command}`,
        };
      }
      const result = await runShell(resolved.cmd, resolved.args, {
        cwd: context.cwd,
        timeout: 60_000,
      });
      if (!result.failed && result.exitCode === 0) {
        return {
          gate: gate.type,
          passed: true,
          ref: gate.command,
          message: `Command passed: ${gate.command}`,
        };
      }
      const safeStdout = redactDiagnosticText(result.stdout);
      const safeStderr = redactDiagnosticText(result.stderr);
      const diag = compressDiagnostic(gate.command, result.exitCode, safeStdout, safeStderr);
      const safeDiagnosis = redactDiagnosticText(diag.diagnosis);
      return {
        gate: gate.type,
        passed: false,
        failureKind: diag.failureKind,
        ref: gate.command,
        command: gate.command,
        exitCode: result.exitCode,
        stdoutTail: tailLines(safeStdout, 10),
        stderrTail: tailLines(safeStderr),
        evidenceText: safeDiagnosis,
        message: safeDiagnosis,
      };
    }

    case "diff-nonempty": {
      const result = await runShell("git", ["diff", "--stat"], {
        cwd: context.cwd,
        timeout: 30_000,
      });
      if (!result.failed && result.exitCode === 0) {
        const hasDiff = result.stdout.trim().length > 0;
        return {
          gate: gate.type,
          passed: hasDiff,
          message: hasDiff
            ? "Git diff is non-empty"
            : "Git diff is empty — no changes produced",
        };
      }
      return {
        gate: gate.type,
        passed: false,
        failureKind: "no_diff",
        message: `Failed to check git diff: ${redactDiagnosticText(result.stderr || result.stdout || "unknown error")}`,
      };
    }

    case "summary-present": {
      const stdout = context.stdout;
      const matchedAlias = SUMMARY_ALIASES.find((a) => stdout.includes(a));
      if (matchedAlias) {
        return {
          gate: gate.type,
          passed: true,
          ref: matchedAlias,
          message: `Summary marker present: ${matchedAlias}`,
        };
      }
      const len = stdout.trim().length;
      if (len >= 200) {
        return {
          gate: gate.type,
          passed: true,
          message: `No explicit summary heading, but output is substantial (${len} chars)`,
        };
      }
      return {
        gate: gate.type,
        passed: false,
        failureKind: "wrong_output",
        message: `Summary marker missing and output is too short (${len} chars)`,
      };
    }

    default:
      return {
        gate: String(gate.type),
        passed: false,
        failureKind: "ambiguous",
        message: `Unknown evidence gate type: ${gate.type}`,
      };
  }
}
