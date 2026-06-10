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
  it("renders rail view without panel borders", async () => {
    const output = await renderCockpit({ view: "rail", terminalWidth: 40, quick: true });
    assert.strictEqual(typeof output, "string");
    assert.ok(!output.includes("┏"), "rail view should not have panel top border");
    assert.ok(!output.includes("┗"), "rail view should not have panel bottom border");
    assert.ok(!output.includes("┃"), "rail view should not have panel side borders");
  });

  it("rail view respects terminal width", async () => {
    for (const width of [28, 32, 40, 56]) {
      const output = await renderCockpit({ view: "rail", terminalWidth: width, quick: true });
      const lines = output.split("\n");
      for (const line of lines) {
        const w = visibleTerminalWidth(line);
        assert.ok(w <= width, `rail view width=${width}: line exceeded width: ${w} > ${width}: ${line.slice(0, 60)}`);
      }
    }
  });

  it("rail view returns exact height lines when height is specified", async () => {
    for (const height of [14, 18, 24]) {
      const output = await renderCockpit({ view: "rail", terminalWidth: 40, height, quick: true });
      const lines = countLines(output);
      assert.strictEqual(lines, height, `rail view height=${height}: expected ${height} lines, got ${lines}`);
    }
  });

  it("rail view includes context and runtime sections", async () => {
    const output = await renderCockpit({ view: "rail", terminalWidth: 40, quick: true });
    const clean = stripAnsi(output);
    assert.ok(clean.includes("Context"), "rail view should include Context section");
    assert.ok(clean.includes("MCP"), "rail view should include MCP section");
    assert.ok(clean.includes("LSP") || clean.includes("LSPs are disabled"), "rail view should include LSP section");
    assert.ok(clean.includes("Todo"), "rail view should include Todo section");
    assert.ok(clean.includes("Modified Files"), "rail view should include Modified Files section");
    assert.ok(clean.includes("OMK"), "rail view should include OMK runtime name");
  });

  it("rail view renders todos and respects height with mocked run", async () => {
    const root = await mkdtemp(join(tmpdir(), "omk-cockpit-rail-"));
    const previousRoot = process.env.OMK_PROJECT_ROOT;
    process.env.OMK_PROJECT_ROOT = root;
    try {
      const runId = "rail-run";
      const runDir = join(root, ".omk", "runs", runId);
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "todos.json"), JSON.stringify([
        { title: "Fix rail view", status: "in_progress", agent: "coder" },
        { title: "Add tests", status: "done" },
      ]));
      await writeFile(join(runDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        runId,
        status: "running",
        startedAt: new Date(Date.now() - 10_000).toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [{
          id: "worker-1",
          name: "Rail Worker",
          role: "worker",
          dependsOn: [],
          status: "running",
          retries: 0,
          maxRetries: 0,
        }],
      }, null, 2));

      const output = await renderCockpit({ runId, view: "rail", terminalWidth: 40, height: 24, quick: true });
      const clean = stripAnsi(output);
      assert.ok(clean.includes("Fix rail view"), "rail view should render todo title");
      assert.ok(clean.includes("coder"), "rail view should render todo agent");
      assert.ok(clean.includes("Add tests"), "rail view should render done todo");
      assert.strictEqual(countLines(output), 24, "rail view should respect height");
    } finally {
      if (previousRoot === undefined) {
        delete process.env.OMK_PROJECT_ROOT;
      } else {
        process.env.OMK_PROJECT_ROOT = previousRoot;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rail view clamps width to rail bounds (28-56)", async () => {
    const narrow = await renderCockpit({ view: "rail", terminalWidth: 20, quick: true });
    const narrowMax = Math.max(...narrow.split("\n").map((l) => visibleTerminalWidth(l)));
    assert.ok(narrowMax <= 28, `rail view should clamp to minimum 28, got max width ${narrowMax}`);

    const wide = await renderCockpit({ view: "rail", terminalWidth: 100, quick: true });
    const wideMax = Math.max(...wide.split("\n").map((l) => visibleTerminalWidth(l)));
    assert.ok(wideMax <= 56, `rail view should clamp to maximum 56, got max width ${wideMax}`);
  });
});
