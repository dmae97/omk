import { describe, it } from "node:test";
import assert from "node:assert";
import {
  classifyFailure,
  compressDiagnostic,
  extractTsError,
  extractTestError,
  extractLintError,
} from "../dist/orchestration/diagnostics.js";

// ─── classifyFailure ─────────────────────────────────────────────────────────

describe("classifyFailure", () => {
  it("classifies TypeScript error from stderr and command", () => {
    const result = classifyFailure("npm run typecheck", 2, "error TS2322: Type 'undefined' is not assignable to type 'string'.");
    assert.equal(result, "type_error");
  });

  it("classifies build error from command and stderr", () => {
    const result = classifyFailure("npm run build", 1, "build failed with unknown error");
    assert.equal(result, "build_error");
  });

  it("classifies test failure from command and stderr", () => {
    const result = classifyFailure("npm test", 1, "Test failed: expected 1 to equal 2");
    assert.equal(result, "test_failure");
  });

  it("classifies lint failure from command and stderr", () => {
    const result = classifyFailure("npm run lint", 1, "eslint error in src/index.ts");
    assert.equal(result, "lint_failure");
  });

  it("classifies missing file from ENOENT stderr", () => {
    const result = classifyFailure(undefined, 1, "ENOENT: no such file or directory, open 'missing.txt'");
    assert.equal(result, "missing_file");
  });

  it("classifies policy violation from permission denied stderr", () => {
    const result = classifyFailure(undefined, 1, "permission denied: cannot write to /etc/config");
    assert.equal(result, "policy_violation");
  });

  it("returns ambiguous for non-zero exit with no recognizable pattern", () => {
    const result = classifyFailure("echo hello", 1, "");
    assert.equal(result, "ambiguous");
  });
});

// ─── extractTsError ──────────────────────────────────────────────────────────

describe("extractTsError", () => {
  it("extracts standard TS error format", () => {
    const result = extractTsError("src/file.ts(42,17): error TS2322: Type 'undefined' is not assignable to type 'string'.");
    assert.ok(result);
    assert.equal(result.location, "src/file.ts:42:17");
    assert.ok(result.primaryError.includes("TS2322"));
    assert.ok(result.primaryError.includes("Type 'undefined' is not assignable"));
    assert.ok(result.likelyCause.length > 0);
    assert.ok(result.requiredFix.length > 0);
  });

  it("extracts alternative TS error format", () => {
    const result = extractTsError("src/file.ts:42:17: error: Type 'undefined' is not assignable to type 'string'.");
    assert.ok(result);
    assert.equal(result.location, "src/file.ts:42:17");
    assert.ok(result.primaryError.includes("Type 'undefined' is not assignable"));
    assert.ok(result.likelyCause.length > 0);
    assert.ok(result.requiredFix.length > 0);
  });

  it("returns null when no TS error pattern matches", () => {
    const result = extractTsError("random text without any structure");
    assert.equal(result, null);
  });
});

// ─── extractTestError ────────────────────────────────────────────────────────

describe("extractTestError", () => {
  it("extracts Jest-style failure details", () => {
    const stderr = "FAIL src/test.ts";
    const stdout = "● should work\nExpected: 1\nReceived: 2";
    const result = extractTestError(stderr, stdout);
    assert.ok(result);
    assert.equal(result.location, "src/test.ts");
    assert.ok(result.primaryError.includes("Expected 1, received 2"));
    assert.ok(result.likelyCause.includes("Logic mismatch"));
  });

  it("returns null when no test error pattern matches", () => {
    const result = extractTestError("random text", "more random text");
    assert.equal(result, null);
  });
});

// ─── extractLintError ────────────────────────────────────────────────────────

describe("extractLintError", () => {
  it("extracts ESLint format error", () => {
    const result = extractLintError("src/file.ts:10:5 error Missing semicolon semi");
    assert.ok(result);
    assert.equal(result.location, "src/file.ts:10:5");
    assert.ok(result.primaryError.includes("Missing semicolon"));
    assert.ok(result.primaryError.includes("semi"));
    assert.ok(result.likelyCause.includes("semi"));
    assert.ok(result.requiredFix.includes("semi"));
  });

  it("returns null when no lint error pattern matches", () => {
    const result = extractLintError("random text without lint structure");
    assert.equal(result, null);
  });
});

// ─── compressDiagnostic ──────────────────────────────────────────────────────

describe("compressDiagnostic", () => {
  it("produces type_error diagnosis for TS stderr", () => {
    const result = compressDiagnostic(
      "npm run typecheck",
      2,
      "",
      "src/main.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'."
    );
    assert.equal(result.failureKind, "type_error");
    assert.ok(result.diagnosis.includes("TypeScript type check failed"));
    assert.ok(result.diagnosis.includes("TS2322"));
  });

  it("produces test_failure diagnosis for jest output", () => {
    const result = compressDiagnostic(
      "npm test",
      1,
      "FAIL src/main.test.ts\n● should calculate correctly\nExpected: 42\nReceived: 0",
      ""
    );
    assert.equal(result.failureKind, "test_failure");
    assert.ok(result.diagnosis.includes("Test execution failed"));
    assert.ok(result.diagnosis.includes("src/main.test.ts"));
  });

  it("produces ambiguous diagnosis for unrecognized stderr", () => {
    const result = compressDiagnostic("unknown-cmd", 1, "", "some random unrecognized error");
    assert.equal(result.failureKind, "ambiguous");
    assert.ok(result.diagnosis.length > 0);
  });
});
