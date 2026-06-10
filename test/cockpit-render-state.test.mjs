import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { renderCockpit, visibleTerminalWidth } = await import("../dist/commands/cockpit.js");

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function maxVisibleWidth(output) {
  return output.split("\n").reduce((max, line) => {
    const len = visibleTerminalWidth(line);
    return len > max ? len : max;
  }, 0);
}

function countLines(output) {
  return output.split("\n").length;
}


describe("renderCockpit", () => {
  it("shows idle chat input wait instead of stale warning for prompt-ready chat state", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-idle-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "chat-idle";
      const runDir = join(root, ".omk", "runs", runId);
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        startedAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:01.000Z",
        lastActivityAt: "2026-05-09T00:00:01.000Z",
        nodes: [{
          id: "chat",
          name: "Chat Session",
          role: "chat",
          dependsOn: [],
          status: "running",
          retries: 0,
          maxRetries: 0,
          startedAt: "2026-05-09T00:00:00.000Z",
        }],
      }, null, 2));

      const output = await renderCockpit({ runId, terminalWidth: 80, height: 24, quick: true });
      const clean = stripAnsi(output);
      assert.match(clean, /idle \/ waiting for input/);
      assert.doesNotMatch(clean, /stale/);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OMK_PROJECT_ROOT;
      } else {
        process.env.OMK_PROJECT_ROOT = previousRoot;
      }
      await rm(root, { recursive: true, force: true });
    }
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

  it("width matrix: every rendered line satisfies visibleTerminalWidth <= requestedWidth and borders align", async () => {
    for (const width of [20, 24, 30, 34, 40, 80, 120, 160]) {
      const output = await renderCockpit({ terminalWidth: width, height: width <= 34 ? 18 : 32, quick: true });
      const lines = output.split("\n");
      for (const line of lines) {
        const w = visibleTerminalWidth(line);
        assert.ok(w <= width, `terminalWidth=${width}: line exceeded width: ${w} > ${width}: ${line.slice(0, 60)}`);
      }
      const topBorder = lines[0];
      const bottomBorder = lines.at(-1);
      assert.strictEqual(
        visibleTerminalWidth(topBorder),
        visibleTerminalWidth(bottomBorder),
        `terminalWidth=${width}: top and bottom border visible widths should match`
      );
    }
  });

  it("height matrix: exact line count matches requested height and is stable across renders", async () => {
    for (const height of [12, 14, 18, 24, 32, 40]) {
      const expected = height === 12 ? 14 : height;
      const counts = new Set();
      for (let i = 0; i < 3; i++) {
        const output = await renderCockpit({ terminalWidth: 80, height, quick: true });
        const lines = countLines(output);
        assert.strictEqual(lines, expected, `height=${height}: expected ${expected} lines, got ${lines}`);
        counts.add(lines);
      }
      assert.strictEqual(counts.size, 1, `height=${height} should produce identical line count across 3 renders, got [${[...counts].join(", ")}]`);
    }
  });

  it("Korean + emoji width: composed Korean, skin tone, ZWJ, fullwidth punctuation", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-emoji-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "emoji-run";
      const runDir = join(root, ".omk", "runs", runId);
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        status: "running",
        startedAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:01.000Z",
        nodes: [{
          id: "chat",
          name: "한글조합형",
          role: "chat",
          dependsOn: [],
          status: "running",
          retries: 0,
          maxRetries: 0,
          thinking: "👍🏽 ZWJ: 👨‍👩‍👧‍👦 punct: ，。",
        }],
      }, null, 2));

      const output = await renderCockpit({ runId, terminalWidth: 40, height: 18, quick: true });
      const widths = output.split("\n").map((line) => visibleTerminalWidth(line));
      assert.ok(Math.max(...widths) <= 40, `emoji output exceeded requested width: ${Math.max(...widths)}`);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OMK_PROJECT_ROOT;
      } else {
        process.env.OMK_PROJECT_ROOT = previousRoot;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ANSI-colored truncation with Korean and emoji mixed", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-ansi-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "ansi-run";
      const runDir = join(root, ".omk", "runs", runId);
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        status: "running",
        startedAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:01.000Z",
        nodes: [{
          id: "worker-1",
          name: "worker",
          role: "worker",
          dependsOn: [],
          status: "running",
          retries: 0,
          maxRetries: 0,
          thinking: "\x1b[31m한글\x1b[0m \x1b[32m👍🏽\x1b[0m \x1b[33m，。\x1b[0m \x1b[34m👨‍👩‍👧‍👦\x1b[0m",
        }],
      }, null, 2));

      const output = await renderCockpit({ runId, terminalWidth: 30, height: 18, quick: true });
      const widths = output.split("\n").map((line) => visibleTerminalWidth(line));
      assert.ok(Math.max(...widths) <= 30, `ANSI+wide output exceeded requested width: ${Math.max(...widths)}`);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OMK_PROJECT_ROOT;
      } else {
        process.env.OMK_PROJECT_ROOT = previousRoot;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renders stale warning for a running worker with lastActivityAgeMs > 30000", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-stale-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "chat-stale";
      const runDir = join(root, ".omk", "runs", runId);
      await mkdir(runDir, { recursive: true });
      const oldDate = new Date(Date.now() - 60_000).toISOString();
      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        startedAt: oldDate,
        updatedAt: oldDate,
        lastActivityAt: oldDate,
        nodes: [{
          id: "worker-1",
          name: "Slow Worker",
          role: "worker",
          dependsOn: [],
          status: "running",
          retries: 0,
          maxRetries: 0,
          startedAt: oldDate,
        }],
      }, null, 2));

      const output = await renderCockpit({ runId, terminalWidth: 80, height: 24, quick: true });
      const clean = stripAnsi(output);
      assert.match(clean, /silent|stalled/);
      assert.doesNotMatch(clean, /idle \/ waiting for input/);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OMK_PROJECT_ROOT;
      } else {
        process.env.OMK_PROJECT_ROOT = previousRoot;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("distinguishes stale worker from idle chat node", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-stale-idle-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "combo-run";
      const runDir = join(root, ".omk", "runs", runId);
      await mkdir(runDir, { recursive: true });
      const oldDate = new Date(Date.now() - 60_000).toISOString();

      // Prevent deriveTodosFromState from creating todos so worker lines render
      await writeFile(join(runDir, "todos.json"), JSON.stringify([]));

      // Scenario 1: running worker with no thinking → silent/stalled, not input-idle
      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        startedAt: oldDate,
        updatedAt: oldDate,
        lastActivityAt: oldDate,
        nodes: [{
          id: "worker-1",
          name: "Slow Worker",
          role: "worker",
          dependsOn: [],
          status: "running",
          retries: 0,
          maxRetries: 0,
          startedAt: oldDate,
        }],
      }, null, 2));

      const output1 = await renderCockpit({ runId, terminalWidth: 80, height: 24, quick: true });
      const clean1 = stripAnsi(output1);
      assert.match(clean1, /silent|stalled/);
      assert.doesNotMatch(clean1, /idle \/ waiting for input/);

      // Scenario 2: running chat with no thinking → idle, no stale
      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        startedAt: oldDate,
        updatedAt: oldDate,
        lastActivityAt: oldDate,
        nodes: [{
          id: "chat",
          name: "Chat Session",
          role: "chat",
          dependsOn: [],
          status: "running",
          retries: 0,
          maxRetries: 0,
          startedAt: oldDate,
        }],
      }, null, 2));

      const output2 = await renderCockpit({ runId, terminalWidth: 80, height: 24, quick: true });
      const clean2 = stripAnsi(output2);
      assert.match(clean2, /idle \/ waiting for input/);
      assert.doesNotMatch(clean2, /silent|stalled/);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OMK_PROJECT_ROOT;
      } else {
        process.env.OMK_PROJECT_ROOT = previousRoot;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renders TODO and AGENTS blocks simultaneously when todos.json exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-todo-agents-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "todo-agents-run";
      const runDir = join(root, ".omk", "runs", runId);
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "todos.json"), JSON.stringify([
        { title: "Implement telemetry", status: "in_progress", agent: "coder" },
      ]));
      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        startedAt: new Date(Date.now() - 10_000).toISOString(),
        updatedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        nodes: [{
          id: "worker-1",
          name: "CockPit renderer",
          role: "worker",
          dependsOn: [],
          status: "running",
          retries: 0,
          maxRetries: 0,
          startedAt: new Date(Date.now() - 10_000).toISOString(),
          thinking: "rendering compact blocks",
        }],
      }, null, 2));

      const output = await renderCockpit({ runId, terminalWidth: 100, height: 32, quick: true });
      const clean = stripAnsi(output);
      assert.match(clean, /TODO/);
      assert.match(clean, /Implement telemetry/);
      assert.match(clean, /AGENTS/);
      assert.match(clean, /CockPit renderer/);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OMK_PROJECT_ROOT;
      } else {
        process.env.OMK_PROJECT_ROOT = previousRoot;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renders nested harness MCP status with failed and connecting servers", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-mcp-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "mcp-run";
      const runDir = join(root, ".omk", "runs", runId);
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        startedAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:01.000Z",
        nodes: [],
      }, null, 2));
      await writeFile(join(runDir, "chat-agent-harness.json"), JSON.stringify({
        resources: {
          workerCap: 3,
          maxStepsPerTurn: "12",
          scopes: { mcp: "project", skills: "project", hooks: "project" },
          active: {
            mcp: ["omk-project", "github", "pdf"],
            skills: ["omk-quality-gate"],
            hooks: ["secret-scan"],
          },
        },
        gates: ["lint", "test"],
      }, null, 2));
      await writeFile(join(runDir, "mcp-status.json"), JSON.stringify({
        servers: [
          { name: "omk-project", status: "connected", toolsCount: 10 },
          { name: "github", status: "failed", toolsCount: 0 },
          { name: "pdf", status: "connecting", toolsCount: 2 },
        ],
      }, null, 2));

      const output = await renderCockpit({
        runId,
        terminalWidth: 120,
        height: 18,
        quick: false,
        section: "mcp",
        deepSeekProvider: async () => null,
      });
      const clean = stripAnsi(output);
      assert.match(clean, /MCP/);
      assert.match(clean, /1\/3 connected/);
      assert.match(clean, /12 tools/);
      assert.match(clean, /connecting: pdf/);
      assert.match(clean, /failed: github/);
      assert.match(clean, /contract/);
      assert.match(clean, /mcp:3/);
      assert.match(clean, /gates:2/);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OMK_PROJECT_ROOT;
      } else {
        process.env.OMK_PROJECT_ROOT = previousRoot;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("redacts apiKey in node evidence messages", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-privacy-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "privacy-run";
      const runDir = join(root, ".omk", "runs", runId);
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        startedAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:01.000Z",
        nodes: [{
          id: "worker-1",
          name: "Worker",
          role: "worker",
          dependsOn: [],
          status: "failed",
          retries: 1,
          maxRetries: 3,
          evidence: [{
            gate: "lint",
            passed: false,
            message: "apiKey=sk-abc1234567890abcdef",
          }],
        }],
      }, null, 2));

      const output = await renderCockpit({ runId, terminalWidth: 80, height: 24, quick: true });
      const clean = stripAnsi(output);
      assert.match(clean, /\*\*\*REDACTED\*\*\*/);
      assert.doesNotMatch(clean, /sk-abc123/);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OMK_PROJECT_ROOT;
      } else {
        process.env.OMK_PROJECT_ROOT = previousRoot;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not leak secrets from harness-like JSON in run directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-harness-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "harness-run";
      const runDir = join(root, ".omk", "runs", runId);
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        startedAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:01.000Z",
        nodes: [],
      }, null, 2));
      await writeFile(join(runDir, "chat-agent-harness.json"), JSON.stringify({
        token: "ghp_supersecrettoken12345",
      }, null, 2));

      const output = await renderCockpit({ runId, terminalWidth: 80, height: 24, quick: true });
      const clean = stripAnsi(output);
      assert.doesNotMatch(clean, /ghp_supersecrettoken/);
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
