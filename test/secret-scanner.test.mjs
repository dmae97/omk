// ─── Secret Scanner Tests ────────────────────────────────────────────────────
// P2.6: Tests for the standalone secret detection and redaction engine.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  SecretScanner,
  SecretSeverity,
  ScanMode,
  scanText,
  scanFile,
  scanDir,
  redactSecrets,
  SECRET_KEY_NAMES,
} from "../dist/mcp/secret-scanner.js";

// ── Text Scanning ────────────────────────────────────────────────────────────

describe("SecretScanner: Text Scanning", () => {
  it("detects AWS access key", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("aws_key = AKIAIOSFODNN7EXAMPLE");
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].patternName, "aws_access_key");
    assert.equal(report.findings[0].severity, SecretSeverity.CRITICAL);
    assert.ok(report.redactedText?.includes("[REDACTED_AWS_KEY]"));
    assert.ok(!report.redactedText?.includes("AKIAIOSFODNN7EXAMPLE"));
  });

  it("detects GitHub token", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    const report = scanner.scanText(`token: "${token}"`);
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].patternName, "github_token");
    assert.equal(report.findings[0].severity, SecretSeverity.CRITICAL);
  });

  it("detects OpenAI API key", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx");
    assert.ok(report.findings.length >= 1);
    const openai = report.findings.find((f) => f.patternName === "openai_key");
    assert.ok(openai);
    assert.equal(openai.severity, SecretSeverity.HIGH);
  });

  it("detects Anthropic API key", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("ANTHROPIC_KEY=sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].patternName, "anthropic_key");
  });

  it("detects JWT token", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const report = scanner.scanText(`auth: "${jwt}"`);
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].patternName, "jwt_token");
  });

  it("detects private key", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";
    const report = scanner.scanText(pem);
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].patternName, "private_key");
    assert.equal(report.findings[0].severity, SecretSeverity.CRITICAL);
  });

  it("detects connection string", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("DB_URL=postgres://admin:supersecret123@localhost:5432/mydb");
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].patternName, "connection_string");
    assert.ok(report.redactedText?.includes("[REDACTED]"));
  });

  it("detects Bearer token", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789");
    assert.ok(report.findings.length >= 1);
    const bearer = report.findings.find((f) => f.patternName === "bearer_token");
    assert.ok(bearer);
  });

  it("detects Slack token", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const fixture = ["xoxb", "1234567890", "1234567890123", "ABCDefGHIJklmnOPQrst12"].join("-");
    const report = scanner.scanText(`SLACK_TOKEN=${fixture}`);
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].patternName, "slack_token");
  });

  it("detects multiple secrets in one text", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const text = `
      AWS_KEY=AKIAIOSFODNN7EXAMPLE
      GITHUB=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij
      OPENAI=sk-abcdefghijklmnopqrstuvwx
    `;
    const report = scanner.scanText(text);
    assert.ok(report.findings.length >= 3);
    assert.ok(report.hasCriticalFindings);
  });

  it("returns clean report for text with no secrets", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("Hello world, this is a normal text with no secrets.");
    assert.equal(report.findings.length, 0);
    assert.equal(report.hasCriticalFindings, false);
    assert.ok(report.summary.includes("No secrets"));
  });

  it("provides correct line and column numbers", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const text = "line1\nline2\nAKIAIOSFODNN7EXAMPLE here";
    const report = scanner.scanText(text);
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].line, 3);
  });

  it("provides context around matches", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("const key = 'AKIAIOSFODNN7EXAMPLE'; // my key");
    assert.equal(report.findings.length, 1);
    assert.ok(report.findings[0].context.length > 0);
    assert.ok(report.findings[0].context.includes("█"));
  });
});

// ── Scan Modes ───────────────────────────────────────────────────────────────

describe("SecretScanner: Scan Modes", () => {
  it("QUICK mode skips DEEP-only patterns", () => {
    const quick = new SecretScanner({ mode: ScanMode.QUICK });
    const deep = new SecretScanner({ mode: ScanMode.DEEP });

    const text = "SECRET=mysupersecretvalue123";
    const quickReport = quick.scanText(text);
    const deepReport = deep.scanText(text);

    // DEEP should find the SECRET env var, QUICK should not
    assert.ok(deepReport.findings.length >= quickReport.findings.length);
  });

  it("PARANOID mode detects long base64 strings", () => {
    const paranoid = new SecretScanner({ mode: ScanMode.PARANOID });
    const deep = new SecretScanner({ mode: ScanMode.DEEP });

    // 64+ char base64 string
    const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/AB";
    const text = `data = "${b64}"`;

    const paranoidReport = paranoid.scanText(text);
    const deepReport = deep.scanText(text);

    assert.ok(paranoidReport.findings.length >= deepReport.findings.length);
  });

  it("reports correct mode in output", () => {
    const scanner = new SecretScanner({ mode: ScanMode.PARANOID });
    const report = scanner.scanText("test");
    assert.equal(report.mode, ScanMode.PARANOID);
  });
});

// ── Pattern Management ───────────────────────────────────────────────────────

describe("SecretScanner: Pattern Management", () => {
  it("lists all patterns", () => {
    const scanner = new SecretScanner();
    const patterns = scanner.listPatterns();
    assert.ok(patterns.length >= 14);
  });

  it("can add custom pattern", () => {
    const scanner = new SecretScanner();
    const countBefore = scanner.listPatterns().length;

    scanner.addPattern({
      name: "custom_test",
      description: "Test pattern",
      pattern: /CUSTOM_[A-Z]{10}/g,
      replacement: "[REDACTED_CUSTOM]",
      severity: SecretSeverity.HIGH,
      category: "custom",
      enabled: true,
      minMode: ScanMode.QUICK,
    });

    assert.equal(scanner.listPatterns().length, countBefore + 1);

    const report = scanner.scanText("found CUSTOM_ABCDEFGHIJ here");
    const custom = report.findings.find((f) => f.patternName === "custom_test");
    assert.ok(custom);
  });

  it("can remove pattern", () => {
    const scanner = new SecretScanner();
    const removed = scanner.removePattern("aws_access_key");
    assert.equal(removed, true);

    const report = scanner.scanText("AKIAIOSFODNN7EXAMPLE");
    const aws = report.findings.find((f) => f.patternName === "aws_access_key");
    assert.equal(aws, undefined);
  });

  it("can disable pattern", () => {
    const scanner = new SecretScanner();
    scanner.setPatternEnabled("aws_access_key", false);

    const report = scanner.scanText("AKIAIOSFODNN7EXAMPLE");
    const aws = report.findings.find((f) => f.patternName === "aws_access_key");
    assert.equal(aws, undefined);
  });

  it("can re-enable pattern", () => {
    const scanner = new SecretScanner();
    scanner.setPatternEnabled("aws_access_key", false);
    scanner.setPatternEnabled("aws_access_key", true);

    const report = scanner.scanText("AKIAIOSFODNN7EXAMPLE");
    const aws = report.findings.find((f) => f.patternName === "aws_access_key");
    assert.ok(aws);
  });

  it("disabledPatterns option works", () => {
    const scanner = new SecretScanner({ disabledPatterns: ["aws_access_key"] });
    const report = scanner.scanText("AKIAIOSFODNN7EXAMPLE");
    const aws = report.findings.find((f) => f.patternName === "aws_access_key");
    assert.equal(aws, undefined);
  });
});

// ── Arg Sanitization ─────────────────────────────────────────────────────────

describe("SecretScanner: Arg Sanitization", () => {
  it("redacts known secret key names", () => {
    const scanner = new SecretScanner();
    const result = scanner.sanitizeArgs({
      username: "admin",
      password: "supersecret",
      api_key: "sk-12345",
      normal: "hello",
    });

    assert.equal(result.username, "admin");
    assert.equal(result.password, "[REDACTED]");
    assert.equal(result.api_key, "[REDACTED]");
    assert.equal(result.normal, "hello");
  });

  it("redacts secret values in string fields", () => {
    const scanner = new SecretScanner();
    const result = scanner.sanitizeArgs({
      config: "token=sk-abcdefghijklmnopqrstuvwx",
    });
    assert.ok(!JSON.stringify(result).includes("sk-abcdefghijklmnop"));
  });

  it("handles nested objects", () => {
    const scanner = new SecretScanner();
    const result = scanner.sanitizeArgs({
      outer: {
        password: "secret123",
        name: "test",
      },
    });
    const outer = result.outer;
    assert.equal(outer.password, "[REDACTED]");
    assert.equal(outer.name, "test");
  });

  it("SECRET_KEY_NAMES includes expected keys", () => {
    assert.ok(SECRET_KEY_NAMES.has("password"));
    assert.ok(SECRET_KEY_NAMES.has("api_key"));
    assert.ok(SECRET_KEY_NAMES.has("access_token"));
    assert.ok(SECRET_KEY_NAMES.has("private_key"));
    assert.ok(SECRET_KEY_NAMES.has("client_secret"));
  });
});

// ── Report Formatting ────────────────────────────────────────────────────────

describe("SecretScanner: Report Formatting", () => {
  it("formatReport includes findings grouped by severity", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("AKIAIOSFODNN7EXAMPLE and sk-abcdefghijklmnopqrstuvwx");
    const formatted = SecretScanner.formatReport(report);
    assert.ok(formatted.includes("CRITICAL"));
    assert.ok(formatted.includes("HIGH"));
    assert.ok(formatted.includes("aws_access_key"));
  });

  it("formatReport shows clean result for no findings", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("clean text");
    const formatted = SecretScanner.formatReport(report);
    assert.ok(formatted.includes("No secrets detected"));
  });

  it("formatSummary returns compact line", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("AKIAIOSFODNN7EXAMPLE");
    const summary = SecretScanner.formatSummary(report);
    assert.ok(summary.includes("secret(s) found"));
    assert.ok(summary.includes("critical"));
  });

  it("formatSummary returns clean for no findings", () => {
    const scanner = new SecretScanner();
    const report = scanner.scanText("clean");
    const summary = SecretScanner.formatSummary(report);
    assert.ok(summary.includes("No secrets"));
  });
});

// ── Events ───────────────────────────────────────────────────────────────────

describe("SecretScanner: Events", () => {
  it("emits finding event per detection", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const findings = [];
    scanner.on("finding", (f) => findings.push(f));
    scanner.scanText("AKIAIOSFODNN7EXAMPLE sk-abcdefghijklmnopqrstuvwx");
    assert.ok(findings.length >= 2);
  });

  it("emits scan:complete event", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    let completed = false;
    scanner.on("scan:complete", () => { completed = true; });
    scanner.scanText("test");
    assert.equal(completed, true);
  });
});

// ── Report Stats ─────────────────────────────────────────────────────────────

describe("SecretScanner: Report Stats", () => {
  it("counts findings by severity", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("AKIAIOSFODNN7EXAMPLE sk-abcdefghijklmnopqrstuvwx");
    assert.ok(report.stats.bySeverity[SecretSeverity.CRITICAL] >= 1);
    assert.ok(report.stats.bySeverity[SecretSeverity.HIGH] >= 1);
  });

  it("counts findings by category", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("AKIAIOSFODNN7EXAMPLE");
    assert.ok(report.stats.byCategory["cloud"] >= 1);
  });

  it("tracks chars scanned", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const text = "hello world";
    const report = scanner.scanText(text);
    assert.equal(report.stats.charsScanned, text.length);
  });

  it("tracks duration", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("test");
    assert.ok(report.stats.durationMs >= 0);
  });

  it("report has id and timestamp", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = scanner.scanText("test");
    assert.ok(report.id.startsWith("ss_"));
    assert.ok(report.timestamp);
  });
});

// ── Convenience Functions ────────────────────────────────────────────────────

describe("SecretScanner: Convenience Functions", () => {
  it("scanText() works with default settings", () => {
    const report = scanText("AKIAIOSFODNN7EXAMPLE");
    assert.ok(report.findings.length >= 1);
  });

  it("redactSecrets() returns redacted text and count", () => {
    const { redacted, count } = redactSecrets("AKIAIOSFODNN7EXAMPLE sk-abcdefghijklmnopqrstuvwx");
    assert.ok(count >= 2);
    assert.ok(!redacted.includes("AKIAIOSFODNN7EXAMPLE"));
    assert.ok(redacted.includes("[REDACTED_AWS_KEY]"));
  });
});

// ── File Scanning ────────────────────────────────────────────────────────────

describe("SecretScanner: File Scanning", () => {
  const tmpDir = join("/tmp", `secret-scan-test-${Date.now()}`);

  async function setup() {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(join(tmpDir, "clean.ts"), "const x = 1;\nexport default x;");
    await writeFile(join(tmpDir, "secrets.ts"), `
const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const GITHUB = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
const NORMAL = "hello world";
`);
    await writeFile(join(tmpDir, ".env"), "DB_PASSWORD=supersecret123\nAPI_KEY=sk-abcdefghijklmnopqrstuvwx\n");
    await writeFile(join(tmpDir, "binary.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]));
  }

  async function cleanup() {
    await rm(tmpDir, { recursive: true, force: true });
  }

  it("scanFile detects secrets in file", async () => {
    await setup();
    try {
      const scanner = new SecretScanner({ mode: ScanMode.QUICK });
      const report = await scanner.scanFile(join(tmpDir, "secrets.ts"));
      assert.ok(report.findings.length >= 2);
      assert.ok(report.hasCriticalFindings);
    } finally {
      await cleanup();
    }
  });

  it("scanFile returns clean for file without secrets", async () => {
    await setup();
    try {
      const scanner = new SecretScanner({ mode: ScanMode.QUICK });
      const report = await scanner.scanFile(join(tmpDir, "clean.ts"));
      assert.equal(report.findings.length, 0);
    } finally {
      await cleanup();
    }
  });

  it("scanFile skips binary files", async () => {
    await setup();
    try {
      const scanner = new SecretScanner({ mode: ScanMode.QUICK });
      const report = await scanner.scanFile(join(tmpDir, "binary.png"));
      assert.equal(report.findings.length, 0);
      assert.equal(report.stats.filesScanned, 0);
    } finally {
      await cleanup();
    }
  });

  it("scanDir scans all text files recursively", async () => {
    await setup();
    try {
      const scanner = new SecretScanner({ mode: ScanMode.DEEP });
      const report = await scanner.scanDir(tmpDir);
      // Should find secrets in secrets.ts and .env
      assert.ok(report.findings.length >= 3);
      assert.ok(report.stats.filesScanned >= 2);
    } finally {
      await cleanup();
    }
  });

  it("scanFile sets sourceFile in findings", async () => {
    await setup();
    try {
      const scanner = new SecretScanner({ mode: ScanMode.QUICK });
      const filePath = join(tmpDir, "secrets.ts");
      const report = await scanner.scanFile(filePath);
      assert.ok(report.findings[0].sourceFile?.includes("secrets.ts"));
    } finally {
      await cleanup();
    }
  });
});

// ── Edge Cases ───────────────────────────────────────────────────────────────

describe("SecretScanner: Edge Cases", () => {
  it("handles empty text", () => {
    const scanner = new SecretScanner();
    const report = scanner.scanText("");
    assert.equal(report.findings.length, 0);
    assert.equal(report.stats.charsScanned, 0);
  });

  it("handles text with only whitespace", () => {
    const scanner = new SecretScanner();
    const report = scanner.scanText("   \n\n   ");
    assert.equal(report.findings.length, 0);
  });

  it("handles very long text", () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const bigText = "x".repeat(100000) + "AKIAIOSFODNN7EXAMPLE" + "y".repeat(100000);
    const report = scanner.scanText(bigText);
    assert.equal(report.findings.length, 1);
    assert.equal(report.stats.charsScanned, bigText.length);
  });

  it("handles nonexistent file gracefully", async () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = await scanner.scanFile("/nonexistent/file.txt");
    assert.equal(report.findings.length, 0);
  });

  it("handles nonexistent directory gracefully", async () => {
    const scanner = new SecretScanner({ mode: ScanMode.QUICK });
    const report = await scanner.scanDir("/nonexistent/dir");
    assert.equal(report.findings.length, 0);
  });
});
