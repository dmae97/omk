import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateRunId,
  sanitizeRunId,
  validateRunArtifactPath,
  getRunPath,
  getRunArtifactPath,
  getRunsDir,
  listValidRunIds,
  RUN_ID_MAX_LENGTH,
  RUN_ARTIFACT_PATH_MAX_LENGTH,
} from "../dist/util/run-store.js";

function makeLongRunId(length) {
  return "a".repeat(length);
}

describe("validateRunId", () => {
  it("accepts valid runIds", () => {
    const valid = [
      "run-123",
      "chat_abc-1",
      "2026-05-01T06-31-49-303Z",
      "my.run.id",
      "a_b-c.1",
    ];
    for (const id of valid) {
      assert.strictEqual(validateRunId(id), id, `should accept ${id}`);
    }
  });

  it("rejects empty string", () => {
    assert.throws(() => validateRunId(""), /empty/);
  });

  it("rejects dot-only segments", () => {
    assert.throws(() => validateRunId("."), /dot-only/);
    assert.throws(() => validateRunId(".."), /dot-only/);
  });

  it("rejects path separators", () => {
    assert.throws(() => validateRunId("foo/bar"), /disallowed/);
    assert.throws(() => validateRunId("foo\\bar"), /disallowed/);
    assert.throws(() => validateRunId("a/../b"), /disallowed/);
  });

  it("rejects absolute and drive paths", () => {
    assert.throws(() => validateRunId("C:\\tmp"), /disallowed/);
    assert.throws(() => validateRunId("/etc/passwd"), /disallowed/);
  });

  it("rejects UNC paths", () => {
    assert.throws(() => validateRunId("\\\\server\\share"), /disallowed/);
  });

  it("rejects reserved name 'latest'", () => {
    assert.throws(() => validateRunId("latest"), /reserved/);
  });

  it("rejects exceeding max length", () => {
    const longId = makeLongRunId(RUN_ID_MAX_LENGTH + 1);
    assert.throws(() => validateRunId(longId), /exceeds/);
  });

  it("accepts max length runId", () => {
    const maxId = makeLongRunId(RUN_ID_MAX_LENGTH);
    assert.strictEqual(validateRunId(maxId), maxId);
  });
});

describe("sanitizeRunId", () => {
  it("sanitizes generated IDs before run-store path construction", () => {
    assert.strictEqual(sanitizeRunId("cron:nightly/job", "cron"), "cron-nightly-job");
    assert.strictEqual(sanitizeRunId("a..b", "run"), "a-b");
  });

  it("falls back to a valid prefixed ID for reserved or empty values", () => {
    assert.match(sanitizeRunId("latest", "cron"), /^cron-\d{4}-\d{2}-\d{2}T/);
    assert.match(sanitizeRunId("", "latest"), /^run-\d{4}-\d{2}-\d{2}T/);
  });
});

describe("getRunPath", () => {
  it("returns path under .omk/runs", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    const p = getRunPath("my-run", "state.json", root);
    assert.ok(p.includes(join(".omk", "runs", "my-run", "state.json")));
  });

  it("rejects invalid runId", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    assert.throws(() => getRunPath("..", "state.json", root), /dot-only/);
  });

  it("rejects artifact traversal before path construction", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    assert.throws(() => getRunPath("my-run", "../state.json", root), /dot-only/);
    assert.throws(() => getRunPath("my-run", "/etc/passwd", root), /absolute/);
    assert.throws(() => getRunPath("my-run", "logs\\state.json", root), /backslash/);
  });

  it("returns directory path when artifact omitted", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    const p = getRunPath("my-run", undefined, root);
    assert.ok(p.includes(join(".omk", "runs", "my-run")));
    assert.ok(!p.endsWith("state.json"));
  });
});

describe("validateRunArtifactPath", () => {
  it("accepts safe run artifact paths", () => {
    const valid = ["state.json", "summary.md", "logs/node-1.log", "evidence_v1/report-2.json"];
    for (const artifact of valid) {
      assert.strictEqual(validateRunArtifactPath(artifact), artifact);
    }
  });

  it("rejects traversal, absolute, drive, UNC, empty, and malformed paths", () => {
    const invalid = [
      "",
      ".",
      "..",
      "../state.json",
      "logs/../state.json",
      "/etc/passwd",
      "C:\\tmp",
      "\\\\server\\share",
      "logs\\state.json",
      "logs//state.json",
      "bad:name.json",
      "space name.txt",
    ];
    for (const artifact of invalid) {
      assert.throws(() => validateRunArtifactPath(artifact), /Invalid run artifact path/);
    }
  });

  it("rejects artifact paths exceeding max length", () => {
    assert.throws(() => validateRunArtifactPath("a".repeat(RUN_ARTIFACT_PATH_MAX_LENGTH + 1)), /exceeds/);
  });

  it("validates run artifact helper inputs", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    assert.ok(getRunArtifactPath("run-1", "logs/node-1.log", root).includes(join(".omk", "runs", "run-1", "logs", "node-1.log")));
    assert.throws(() => getRunArtifactPath("latest", "state.json", root), /reserved/);
    assert.throws(() => getRunArtifactPath("run-1", "../state.json", root), /dot-only/);
  });
});

describe("getRunsDir", () => {
  it("returns .omk/runs under given root", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    const p = getRunsDir(root);
    assert.strictEqual(p, join(root, ".omk", "runs"));
  });
});

describe("listValidRunIds", () => {
  it("lists only valid run directories", async () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    const runsDir = getRunsDir(root);
    mkdirSync(join(runsDir, "run-1"), { recursive: true });
    mkdirSync(join(runsDir, "run-2"), { recursive: true });
    mkdirSync(join(runsDir, "latest"), { recursive: true });
    mkdirSync(join(runsDir, ".."), { recursive: true });
    mkdirSync(join(runsDir, "bad/run"), { recursive: true });

    const ids = await listValidRunIds(root);
    assert.ok(ids.includes("run-1"));
    assert.ok(ids.includes("run-2"));
    assert.ok(!ids.includes("latest"), "should skip reserved name");
  });

  it("returns empty array when runs dir does not exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    const ids = await listValidRunIds(root);
    assert.deepStrictEqual(ids, []);
  });
});
