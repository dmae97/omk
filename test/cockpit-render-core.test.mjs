import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { CockpitRenderer, renderCockpit, visibleTerminalWidth } = await import("../dist/commands/cockpit.js");

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
  it("returns a string with default placeholder run", async () => {
    const output = await renderCockpit({ terminalWidth: 80, quick: true });
    assert.strictEqual(typeof output, "string");
    assert.ok(output.includes("OMK//CONTROL COCKPIT"), "should contain themed OMK control header");
    assert.ok(output.includes("NEON GRID"), "should contain neon-grid theme copy");
    assert.ok(output.includes("run"), "should contain run id placeholder");
  });

  it("renders oxidized-forge cockpit chrome when OMK_THEME=rust-forge", async () => {
    const previousTheme = process.env.OMK_THEME;
    process.env.OMK_THEME = "rust-forge";
    try {
      const output = await renderCockpit({ terminalWidth: 100, quick: true });
      assert.ok(output.includes("OMK//CONTROL COCKPIT"), "control header should remain");
      assert.ok(output.includes("OXIDIZED FORGE"), "rust-forge subtitle should be live");
      assert.match(output, /\x1b\[38;2;255;106;61m/, "rust-forge route/accent color should render");
    } finally {
      if (previousTheme === undefined) delete process.env.OMK_THEME;
      else process.env.OMK_THEME = previousTheme;
      const { setBrandPaletteTheme } = await import("../dist/brand/palette.js");
      setBrandPaletteTheme("night-city");
    }
  });

  it("does not exceed the requested visible columns when terminalWidth is 40", async () => {
    const output = await renderCockpit({ terminalWidth: 40, quick: true });
    const maxWidth = maxVisibleWidth(output);
    assert.ok(maxWidth <= 40, `max visible width ${maxWidth} should not exceed requested width 40`);
  });

  it("keeps responsive widths bounded for common cockpit pane sizes", async () => {
    for (const width of [40, 60, 80, 120]) {
      const output = await renderCockpit({ terminalWidth: width, height: width === 40 ? 18 : 32, quick: true });
      const maxWidth = maxVisibleWidth(output);
      assert.ok(maxWidth <= width, `terminalWidth=${width} produced max visible width ${maxWidth}`);
    }
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

  it("keeps Korean and emoji cockpit rows within the requested width", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-wide-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "wide-run";
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
          name: "코더🚀가 긴 한국어 상태를 처리합니다",
          role: "chat",
          dependsOn: [],
          status: "running",
          retries: 0,
          maxRetries: 0,
          thinking: "도구 실행 중 🔧",
        }],
      }, null, 2));

      const output = await renderCockpit({ runId, terminalWidth: 40, height: 18, quick: true });
      const widths = output.split("\n").map((line) => visibleTerminalWidth(line));
      assert.ok(Math.max(...widths) <= 40, `wide output exceeded requested width: ${Math.max(...widths)}`);
      assert.equal(widths[0], widths.at(-1), "top and bottom borders should align");
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OMK_PROJECT_ROOT;
      } else {
        process.env.OMK_PROJECT_ROOT = previousRoot;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("watch renderer pins to a fixed fallback height when pane rows are unavailable", () => {
    const originalRows = process.stdout.rows;
    try {
      delete process.stdout.rows;
      const renderer = new CockpitRenderer(1000);
      assert.strictEqual(renderer.height, 32);
    } finally {
      if (originalRows === undefined) {
        delete process.stdout.rows;
      } else {
        process.stdout.rows = originalRows;
      }
    }
  });

  it("watch renderer pins to tmux pane rows when available", () => {
    const originalRows = process.stdout.rows;
    try {
      process.stdout.rows = 20;
      const renderer = new CockpitRenderer(1000);
      assert.strictEqual(renderer.height, 20);
    } finally {
      if (originalRows === undefined) {
        delete process.stdout.rows;
      } else {
        process.stdout.rows = originalRows;
      }
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

  it("clamps height below MIN_COCKPIT_HEIGHT to the floor", async () => {
    const output = await renderCockpit({ terminalWidth: 80, height: 12, quick: true });
    const lines = countLines(output);
    assert.strictEqual(lines, 14, `height=12 should clamp to MIN_COCKPIT_HEIGHT (14), got ${lines}`);
  });

  it("does not exceed mocked process.stdout.rows in auto height mode", async () => {
    const originalRows = process.stdout.rows;
    process.stdout.rows = 20;
    try {
      const output = await renderCockpit({ terminalWidth: 80, quick: true });
      const lines = countLines(output);
      assert.ok(lines <= 20, `auto height should not exceed mocked process.stdout.rows (20), got ${lines}`);
    } finally {
      if (originalRows === undefined) {
        delete process.stdout.rows;
      } else {
        process.stdout.rows = originalRows;
      }
    }
  });

  it("clamps fixed height to very short tmux pane rows to avoid scrolling", async () => {
    const originalRows = process.stdout.rows;
    process.stdout.rows = 10;
    try {
      const output = await renderCockpit({ terminalWidth: 80, height: 18, quick: true });
      const lines = countLines(output);
      assert.strictEqual(lines, 10, `fixed height should clamp to pane rows (10), got ${lines}`);
    } finally {
      if (originalRows === undefined) {
        delete process.stdout.rows;
      } else {
        process.stdout.rows = originalRows;
      }
    }
  });

  it("returns exactly 24 lines for height 24", async () => {
    const output = await renderCockpit({ terminalWidth: 80, height: 24, quick: true });
    const lines = countLines(output);
    assert.strictEqual(lines, 24, `expected 24 lines for height=24, got ${lines}`);
  });

  it("renders MCP health, evidence gate, and team runtime sections for a fixture state", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-fixture-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "fixture-run";
      const runDir = join(root, ".omk", "runs", runId);
      await mkdir(runDir, { recursive: true });

      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        status: "running",
        startedAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:01.000Z",
        teamRuntime: {
          session: "team-42",
          status: "ready",
          workerCount: 3,
          reviewerCount: 1,
          coordinatorPanes: 2,
          windows: [
            { index: 0, name: "coord", role: "coordinator", status: "present" },
            { index: 1, name: "w1", role: "worker", status: "present" },
            { index: 2, name: "w2", role: "worker", status: "missing" },
          ],
          statePath: "/tmp/team.state",
          updatedAt: "2026-05-09T00:00:00.000Z",
        },
        nodes: [
          { id: "n1", name: "Node One", role: "coder", dependsOn: [], status: "done", retries: 0, maxRetries: 0, evidence: [{ gate: "lint", passed: true }] },
          { id: "n2", name: "Node Two", role: "reviewer", dependsOn: [], status: "failed", retries: 0, maxRetries: 0, evidence: [{ gate: "security", passed: false, message: "secret leaked" }] },
          { id: "n3", name: "Node Three", role: "explorer", dependsOn: [], status: "running", retries: 0, maxRetries: 0 },
        ],
      }, null, 2));

      await writeFile(join(runDir, "chat-agent-harness.json"), JSON.stringify({
        resources: {
          active: {
            mcp: Array.from({ length: 17 }, (_, i) => ({ name: `server-${i}`, status: i < 14 ? "connected" : i < 16 ? "connecting" : "failed", toolsCount: i })),
            skills: [{ name: "skill-a" }],
            hooks: [{ name: "hook-a" }],
          },
          scopes: { mcp: "all" },
          maxStepsPerTurn: 10,
          workerCap: 4,
        },
        gates: [{ kind: "lint" }, { kind: "security" }],
      }, null, 2));

      const resources = {
        scope: "run",
        mcpServers: Array.from({ length: 17 }, (_, i) => ({ name: `server-${i}`, source: "run", status: i < 14 ? "connected" : i < 16 ? "connecting" : "failed", toolsCount: i })),
        skills: [{ name: "skill-a", source: "run" }],
        hooks: [{ name: "hook-a", source: "run" }],
        checkedAt: Date.now(),
      };

      const output = await renderCockpit({
        runId,
        terminalWidth: 100,
        height: 40,
        quick: true,
        cache: {
          resources: { value: resources, ts: Date.now() },
          primaryUsage: { value: null, ts: Date.now() },
          systemUsage: { value: null, ts: Date.now() },
          deepSeek: { value: null, ts: Date.now() },
          events: { value: [], ts: Date.now() },
          stateTodos: { value: null, ts: Date.now() },
          gitChanges: { value: [], ts: Date.now() },
        },
      });

      const stripped = stripAnsi(output);

      assert.ok(stripped.includes("●14"), "should show 14 connected MCP servers");
      assert.ok(stripped.includes("◐2"), "should show 2 connecting MCP servers");
      assert.ok(stripped.includes("✕1"), "should show 1 failed MCP server");
      assert.ok(stripped.includes("server-16"), "should list a top-offender failed server");

      assert.ok(stripped.includes("✓1"), "should show 1 passed evidence gate");
      assert.ok(stripped.includes("✗1"), "should show 1 failed evidence gate");
      assert.ok(stripped.includes("◐1"), "should show 1 pending evidence gate");

      assert.ok(stripped.includes("Team Runtime"), "should show Team Runtime header");
      assert.ok(stripped.includes("team-42"), "should show team session");
      assert.ok(stripped.includes("2/3"), "should show present windows count");
      assert.ok(stripped.includes("1 expected window(s) missing"), "should show missing windows");

      // Existing sections unchanged
      assert.ok(stripped.includes("OMK//CONTROL COCKPIT"), "header should remain");
      assert.ok(stripped.includes("AGENTS"), "agents section should remain");
    } finally {
      if (previousRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
      else process.env.OMK_PROJECT_ROOT = previousRoot;
      await rm(root, { recursive: true, force: true });
    }
  });
});
