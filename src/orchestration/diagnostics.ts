/**
 * Diagnostic extraction helpers for evidence-gate failure analysis.
 *
 * Extracts structured failure information from command stdout/stderr,
 * classifies the failure kind, and builds a human-readable diagnosis.
 */

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

export interface DiagnosticExtraction {
  primaryError: string;
  location: string;
  likelyCause: string;
  requiredFix: string;
}

const TAIL_LINES = 30;
const MAX_DIAGNOSTIC_LEN = 2000;

export function tailLines(text: string, n = TAIL_LINES): string {
  const lines = redactSecretText(text).redacted.split("\n");
  const tail = lines.slice(-n).join("\n");
  return tail.length > MAX_DIAGNOSTIC_LEN ? tail.slice(0, MAX_DIAGNOSTIC_LEN) : tail;
}

export function redactDiagnosticText(text: string): string {
  return redactSecretText(text).redacted;
}

export function classifyFailure(command: string | undefined, exitCode: number | undefined, stderr: string): EvidenceFailureKind {
  const cmd = command ?? "";
  const lc = stderr.toLowerCase();

  // TypeScript build/type errors (check before generic build)
  if (
    lc.includes("error ts") ||
    (lc.includes("tsc") && lc.includes("error")) ||
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
    (lc.includes("module not found") && lc.includes("error"))
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
    (lc.includes("snapshot") && lc.includes("mismatch"))
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
    (/\d+\s+(error|warning)/i.test(stderr) && lc.includes("lint"))
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

export function extractTsError(stderr: string): DiagnosticExtraction | null {
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

export function extractTestError(stderr: string, stdout: string): DiagnosticExtraction | null {
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

export function extractLintError(stderr: string): DiagnosticExtraction | null {
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

export function extractGenericError(stderr: string): DiagnosticExtraction {
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

export function inferTsCause(code: string, msg: string): string {
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

export function suggestTsFix(code: string, msg: string): string {
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

export function buildDiagnosis(kind: EvidenceFailureKind, extraction: DiagnosticExtraction): string {
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

export function compressDiagnostic(
  command: string | undefined,
  exitCode: number | undefined,
  stdout: string,
  stderr: string
): { failureKind: EvidenceFailureKind; diagnosis: string } {
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
