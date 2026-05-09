import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { renderCockpit } = await import("../dist/commands/cockpit.js");

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function maxVisibleWidth(output) {
  return output.split("\n").reduce((max, line) => {
    const len = stripAnsi(line).length;
    return len > max ? len : max;
  }, 0);
}

function countLines(output) {
  return output.split("\n").length;
}

describe("renderCockpit", () => {
  it("returns a string with default placeholder run", async () => {
    const output = await renderCockpit({ terminalWidth: 80, quick: true });
    assert.strictEqual(typeof output, "string");
    assert.ok(output.includes("OMK Cockpit"), "should contain header");
    assert.ok(output.includes("run"), "should contain run id placeholder");
  });

  it("does not exceed the requested visible columns when terminalWidth is 40", async () => {
    const output = await renderCockpit({ terminalWidth: 40, quick: true });
    const maxWidth = maxVisibleWidth(output);
    assert.ok(maxWidth <= 40, `max visible width ${maxWidth} should not exceed requested width 40`);
  });

  it("fits very narrow tmux side panes without wrapping borders", async () => {
    for (const width of [20, 24, 30, 34]) {
      const output = await renderCockpit({ terminalWidth: width, height: 18, quick: true });
      const visibleLines = output.split("\n").map(stripAnsi);
      const maxWidth = Math.max(...visibleLines.map((line) => line.length));
      assert.ok(maxWidth <= width, `terminalWidth=${width} produced max visible width ${maxWidth}`);
      assert.equal(visibleLines[0].length, maxWidth, `terminalWidth=${width} top border should define frame width`);
      assert.equal(visibleLines.at(-1).length, maxWidth, `terminalWidth=${width} bottom border should match top border`);
    }
  });

  it("returns exactly 18 lines for height 18 (panel borders + body)", async () => {
    const output = await renderCockpit({ terminalWidth: 80, height: 18, quick: true });
    const lines = countLines(output);
    assert.strictEqual(lines, 18, `expected 18 lines for height=18, got ${lines}`);
  });

  it("returns exactly 14 lines for height 14", async () => {
    const output = await renderCockpit({ terminalWidth: 80, height: 14, quick: true });
    const lines = countLines(output);
    assert.strictEqual(lines, 14, `expected 14 lines for height=14, got ${lines}`);
  });

  it("returns exactly 24 lines for height 24", async () => {
    const output = await renderCockpit({ terminalWidth: 80, height: 24, quick: true });
    const lines = countLines(output);
    assert.strictEqual(lines, 24, `expected 24 lines for height=24, got ${lines}`);
  });

  it("auto-expands vertically when height is omitted so agent rows remain visible", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-tall-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "cockpit-tall";
      const runDir = join(root, ".omk", "runs", runId);
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        startedAt: "2026-05-09T00:00:00.000Z",
        nodes: Array.from({ length: 28 }, (_, index) => ({
          id: `agent-${String(index).padStart(2, "0")}`,
          name: `agent-row-${String(index).padStart(2, "0")}`,
          role: "worker",
          dependsOn: [],
          status: "pending",
          retries: 0,
          maxRetries: 1,
          attempts: [],
        })),
      }, null, 2));

      const output = await renderCockpit({ runId, terminalWidth: 120, quick: true });
      const clean = stripAnsi(output);
      assert.match(clean, /agent-row-27/);
      assert.ok(countLines(output) > 32, "auto height should grow beyond the default shell frame");
      assert.ok(maxVisibleWidth(output) <= 120, "auto-height frame should still respect terminal width");
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OMK_PROJECT_ROOT;
      } else {
        process.env.OMK_PROJECT_ROOT = previousRoot;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("maintains stable line count across multiple renders", async () => {
    const heights = [14, 18, 24];
    for (const h of heights) {
      const counts = new Set();
      for (let i = 0; i < 5; i++) {
        const output = await renderCockpit({ terminalWidth: 80, height: h, quick: true });
        counts.add(countLines(output));
      }
      assert.strictEqual(counts.size, 1, `height=${h} should produce identical line count across 5 renders, got [${[...counts].join(", ")}]`);
    }
  });

  it("renders all-scope resources plus DeepSeek balance and run usage", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-deepseek-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "cockpit-deepseek";
      const runDir = join(root, ".omk", "runs", runId);
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        startedAt: "2026-05-09T00:00:00.000Z",
        nodes: [
          {
            id: "deepseek-pro-agent",
            name: "DeepSeek Pro critical model review",
            role: "reviewer",
            dependsOn: [],
            status: "done",
            retries: 0,
            maxRetries: 1,
            attempts: [
              {
                attempt: 1,
                startedAt: "2026-05-09T00:00:00.000Z",
                completedAt: "2026-05-09T00:00:01.000Z",
                status: "done",
                provider: "deepseek",
                requestedProvider: "deepseek",
                providerModel: "deepseek-v4-pro",
                providerModelTier: "pro",
                providerParticipation: "direct",
              },
            ],
          },
        ],
      }, null, 2));

      const output = await renderCockpit({
        runId,
        terminalWidth: 120,
        height: 24,
        quick: true,
        resourceProvider: async () => ({
          scope: "all",
          checkedAt: Date.now(),
          mcpServers: [{ name: "omk-project", source: "project" }, { name: "railway", source: "global" }],
          skills: [{ name: "omk-quality-gate", source: "project" }, { name: "awesome-design-md", source: "global" }],
          hooks: [{ name: "pre-shell-guard.sh", source: "project" }, { name: "UserPromptSubmit", source: "global" }],
        }),
        deepSeekProvider: async () => ({
          enabled: true,
          apiKeySet: true,
          apiKeySource: "omk-secrets",
          available: true,
          checkedAt: Date.now(),
          balances: [{ currency: "USD", total: "12.34", granted: "2.00", toppedUp: "10.34" }],
        }),
      });
      const clean = stripAnsi(output);
      assert.match(clean, /DeepSeek ok bal:USD 12\.34 use:1 pro:1 d:1 a:0 f:0/);
      assert.match(clean, /pro:1/);
      assert.match(clean, /mcp:2 skills:2 hooks:2 scope:all/);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OMK_PROJECT_ROOT;
      } else {
        process.env.OMK_PROJECT_ROOT = previousRoot;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});
