import { access, realpath } from "fs/promises";
import { constants } from "fs";
import { isAbsolute, relative, resolve } from "path";
import type { DagNodeEvidence } from "./dag.js";
import { runShell } from "../util/shell.js";
import { createDecisionTraceStore } from "../evidence/decision-trace.js";
import { redactSecrets as redactSecretText } from "../mcp/secret-scanner.js";

export type EvidenceFailureKind =
  | "build_error"
  | "type_error"
  | "test_failure"
  | "lint_failure"
  | "missing_file"
  | "no_diff"
  | "wrong_output"
  | "policy_violation"
  | "ambiguous";

export interface EvidenceResult extends DagNodeEvidence {
  failureKind?: EvidenceFailureKind;
  command?: string;
  exitCode?: number;
  stdoutTail?: string;
  stderrTail?: string;
  evidenceText?: string;
}

const TAIL_LINES = 30;
const MAX_DIAGNOSTIC_LEN = 2000;

function tailLines(text: string, n = TAIL_LINES): string {
  const lines = redactSecretText(text).redacted.split("\n");
  const tail = lines.slice(-n).join("\n");
  return tail.length > MAX_DIAGNOSTIC_LEN ? tail.slice(0, MAX_DIAGNOSTIC_LEN) : tail;
}

function redactDiagnosticText(text: string): string {
  return redactSecretText(text).redacted;
}

function classifyFailure(command: string | undefined, exitCode: number | undefined, stderr: string): EvidenceFailureKind {
  const cmd = command ?? "";
  const lc = stderr.toLowerCase();

  // TypeScript build/type errors (check before generic build)
  if (
    lc.includes("error ts") ||
    lc.includes("tsc") && lc.includes("error") ||
    /type\s+error/i.test(stderr) ||
    /\bts\d{4}\b/.test(stderr) ||
    cmd.includes("tsc") ||
    cmd.includes("typecheck") ||
    cmd.includes("type-check")
  ) {
    return "type_error";
  }

  // Build errors (webpack, vite, esbuild, rollup, next)
  if (
    cmd.includes("build") ||
    cmd.includes("compile") ||
    lc.includes("build failed") ||
    lc.includes("compilation error") ||
    lc.includes("module not found") && lc.includes("error")
  ) {
    return "build_error";
  }

  // Test failures (jest, vitest, mocha, ava, tap)
  if (
    cmd.includes("test") ||
    cmd.includes("jest") ||
    cmd.includes("vitest") ||
    cmd.includes("mocha") ||
    cmd.includes("ava") ||
    lc.includes("test failed") ||
    lc.includes("assertion") ||
    lc.includes("expect(") ||
    /\d+\s+failed/.test(stderr) ||
    lc.includes("snapshot") && lc.includes("mismatch")
  ) {
    return "test_failure";
  }

  // Lint failures (eslint, biome, oxlint)
  if (
    cmd.includes("lint") ||
    cmd.includes("eslint") ||
    cmd.includes("biome") ||
    lc.includes("eslint") ||
    lc.includes("biome") ||
    /\d+\s+(error|warning)/i.test(stderr) && lc.includes("lint")
  ) {
    return "lint_failure";
  }

  // Missing file/module
  if (
    lc.includes("enoent") ||
    lc.includes("no such file") ||
    lc.includes("cannot find module") ||
    lc.includes("module not found") ||
    lc.includes("file not found")
  ) {
    return "missing_file";
  }

  // Policy violations
  if (
    lc.includes("policy") ||
    lc.includes("forbidden") ||
    lc.includes("blocked") ||
    lc.includes("not allowed") ||
    lc.includes("permission denied")
  ) {
    return "policy_violation";
  }

  // Non-zero exit with no other signal
  if (exitCode !== undefined && exitCode !== 0) {
    return "ambiguous";
  }
  return "ambiguous";
}

interface DiagnosticExtraction {
  primaryError: string;
  location: string;
  likelyCause: string;
  requiredFix: string;
}

function extractTsError(stderr: string): DiagnosticExtraction | null {
  // Match: src/file.ts:42:17 - error TS2322: Type 'undefined' is not assignable...
  const tsPattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/m;
  const tsMatch = stderr.match(tsPattern);
  if (tsMatch) {
    const [, file, line, col, code, msg] = tsMatch;
    return {
      primaryError: `${code}: ${msg?.trim()}`,
      location: `${file}:${line}:${col}`,
      likelyCause: inferTsCause(code ?? "", msg ?? ""),
      requiredFix: suggestTsFix(code ?? "", msg ?? ""),
    };
  }

  // Alternative: src/file.ts:42:17 - error: Type 'undefined' is not assignable...
  const altPattern = /^(.+?):(\d+):(\d+):\s+error:\s+(.+)$/m;
  const altMatch = stderr.match(altPattern);
  if (altMatch) {
    const [, file, line, col, msg] = altMatch;
    return {
      primaryError: msg?.trim() ?? "",
      location: `${file}:${line}:${col}`,
      likelyCause: inferTsCause("", msg ?? ""),
      requiredFix: suggestTsFix("", msg ?? ""),
    };
  }
  return null;
}

function extractTestError(stderr: string, stdout: string): DiagnosticExtraction | null {
  const combined = stderr + "\n" + stdout;

  // FAIL path/to/test.ts
  const failPattern = /FAIL\s+(\S+\.\w+(?:\.\w+)?)/i;
  const failMatch = combined.match(failPattern);

  // ● Test suite > test name
  const testPattern = /●\s+(.+?)$/m;
  const testMatch = combined.match(testPattern);

  // expect(received).toBe(expected)
  const expectPattern = /Expected:\s*(.+?)\nReceived:\s*(.+?)(?:\n|$)/;
  const expectMatch = combined.match(expectPattern);

  // Assertion error
  const assertPattern = /AssertionError:\s*(.+?)(?:\n|$)/i;
  const assertMatch = combined.match(assertPattern);

  const file = failMatch?.[1] ?? "";
  const testName = testMatch?.[1] ?? "";
  const assertion = expectMatch
    ? `Expected ${expectMatch[1]?.trim()}, received ${expectMatch[2]?.trim()}`
    : assertMatch?.[1]?.trim() ?? "";

  if (!file && !testName && !assertion) return null;

  return {
    primaryError: assertion || "Test assertion failed",
    location: file || testName || "unknown",
    likelyCause: assertion
      ? "Logic mismatch between expected and actual behavior"
      : "Test setup or implementation changed expected behavior",
    requiredFix: assertion
      ? `Fix implementation or update expected value: ${assertion.slice(0, 120)}`
      : "Review test assertions and recent code changes",
  };
}

function extractLintError(stderr: string): DiagnosticExtraction | null {
  // path/file.ts:10:5 error message eslint/rule-name
  const lintPattern = /^(.+?):(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(\S+)$/m;
  const lintMatch = stderr.match(lintPattern);
  if (lintMatch) {
    const [, file, line, col, severity, msg, rule] = lintMatch;
    return {
      primaryError: `${severity}: ${msg?.trim()} (${rule})`,
      location: `${file}:${line}:${col}`,
      likelyCause: `Lint rule '${rule}' violation`,
      requiredFix: `Fix '${rule}' violation: ${msg?.trim()}`,
    };
  }
  return null;
}

function extractGenericError(stderr: string): DiagnosticExtraction {
  const lines = stderr.split("\n").filter((l) => l.trim().length > 0);
  // Find first line with 'error' or 'Error'
  const errorLine = lines.find((l) => /error/i.test(l)) ?? lines[lines.length - 1] ?? "";
  return {
    primaryError: errorLine.trim().slice(0, 200),
    location: "unknown",
    likelyCause: "See stderr output for details",
    requiredFix: "Review error output and fix the reported issue",
  };
}

function inferTsCause(code: string, msg: string): string {
  const lm = msg.toLowerCase();
  if (code === "TS2322" || lm.includes("not assignable")) {
    if (lm.includes("undefined")) return "A value that can be undefined is used where a concrete type is required";
    if (lm.includes("null")) return "A nullable value is used without null check";
    return "Type mismatch between declaration and usage";
  }
  if (code === "TS2307" || lm.includes("cannot find module")) return "Module path is incorrect or dependency is not installed";
  if (code === "TS2339" || lm.includes("does not exist on type")) return "Property access on wrong type or missing type declaration";
  if (code === "TS2345" || lm.includes("not assignable to parameter")) return "Argument type does not match function parameter type";
  if (code === "TS2554" || lm.includes("expected.*arguments")) return "Wrong number of arguments passed to function";
  if (code === "TS7006") return "Implicit 'any' — add explicit type annotation";
  if (code === "TS7053") return "Index access on object without index signature";
  if (lm.includes("import")) return "Import path or named export mismatch";
  return "Type error — check the reported type mismatch";
}

function suggestTsFix(code: string, msg: string): string {
  const lm = msg.toLowerCase();
  if (code === "TS2322" && lm.includes("undefined")) return "Add explicit guard, default value, or non-null assertion before assignment";
  if (code === "TS2322" && lm.includes("null")) return "Add null check or use optional chaining before assignment";
  if (code === "TS2307") return "Verify import path, check package.json, and ensure dependency is installed";
  if (code === "TS2339") return "Add property to type definition or use type assertion";
  if (code === "TS2345") return "Cast argument to expected type or update function signature";
  if (code === "TS2554") return "Add missing arguments or make parameters optional";
  if (code === "TS7006") return "Add explicit type annotation to the parameter";
  if (code === "TS7053") return "Add index signature to type or use Record<string, unknown>";
  return "Fix the type error reported at the indicated location";
}

function buildDiagnosis(kind: EvidenceFailureKind, extraction: DiagnosticExtraction): string {
  const parts: string[] = [];
  switch (kind) {
    case "type_error":
      parts.push("TypeScript type check failed.");
      break;
    case "build_error":
      parts.push("Build failed.");
      break;
    case "test_failure":
      parts.push("Test execution failed.");
      break;
    case "lint_failure":
      parts.push("Lint check failed.");
      break;
    case "missing_file":
      parts.push("Required file missing.");
      break;
    case "policy_violation":
      parts.push("Policy violation detected.");
      break;
    default:
      parts.push("Command failed.");
  }
  if (extraction.location !== "unknown") parts.push(`Location: ${extraction.location}`);
  parts.push(`Error: ${extraction.primaryError}`);
  parts.push(`Likely cause: ${extraction.likelyCause}`);
  parts.push(`Fix: ${extraction.requiredFix}`);
  return parts.join("\n");
}

export function compressDiagnostic(command: string | undefined, exitCode: number | undefined, stdout: string, stderr: string): { failureKind: EvidenceFailureKind; diagnosis: string } {
  const kind = classifyFailure(command, exitCode, stderr);

  let extraction: DiagnosticExtraction;
  switch (kind) {
    case "type_error":
      extraction = extractTsError(stderr) ?? extractGenericError(stderr);
      break;
    case "test_failure":
      extraction = extractTestError(stderr, stdout) ?? extractGenericError(stderr);
      break;
    case "lint_failure":
      extraction = extractLintError(stderr) ?? extractGenericError(stderr);
      break;
    default:
      extraction = extractGenericError(stderr);
  }

  const diagnosis = buildDiagnosis(kind, extraction);
  return { failureKind: kind, diagnosis };
}

/** Allowlist pattern reused from quality-gate.ts */
const SCRIPT_NAME_PATTERN = /^[A-Za-z0-9:_-]+$/;
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

/**
 * Agent-freedom mode (e.g. SWE-bench / DeepSWE) relaxes command-pass gate
 * allowlisting so agents can run arbitrary test/build/lint commands.
 */
function isStrictGuardrailMode(): boolean {
  const raw = process.env.OMK_STRICT_GUARDRAIL ?? "";
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}

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

function resolveSafeCommand(command: string): { cmd: string; args: string[] } | null {
  const trimmed = command.trim();
  const parts = trimmed.split(/\s+/);
  if (!isStrictGuardrailMode()) {
    return { cmd: parts[0], args: parts.slice(1) };
  }
  if (parts.length === 1 && SCRIPT_NAME_PATTERN.test(parts[0])) {
    return { cmd: "npm", args: ["run", parts[0]] };
  }
  if (parts.length >= 2 && PACKAGE_MANAGERS.has(parts[0]) && parts[1] === "run" && SCRIPT_NAME_PATTERN.test(parts[2] ?? "")) {
    return { cmd: parts[0], args: parts.slice(1) };
  }
  if (parts.length >= 2 && PACKAGE_MANAGERS.has(parts[0]) && SCRIPT_NAME_PATTERN.test(parts[1] ?? "")) {
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

async function resolveWorkspaceRealPath(cwd: string, resolvedPath: string): Promise<string | null> {
  const root = await realpath(resolve(cwd));
  const candidate = await realpath(resolvedPath);
  const relativePath = relative(root, candidate);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return candidate;
  }
  return null;
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
