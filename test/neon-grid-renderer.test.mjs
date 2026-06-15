import test from "node:test";
import assert from "node:assert/strict";

const { NeonGridRenderer } = await import("../dist/cli/ui/neon-grid-renderer.js");
const { defaultChatUiForBrand, resolveChatUi, renderChatIntro } = await import("../dist/commands/chat/utils.js");

function createStreams(columns = 80, isTTY = false) {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    streams: {
      stdout: { write: (chunk) => stdout.push(String(chunk)), columns },
      stderr: { write: (chunk) => stderr.push(String(chunk)), isTTY, columns },
    },
  };
}

test("NeonGridRenderer renders OMK Control copy without cloning external brands", () => {
  const { stdout, stderr, streams } = createStreams(92);
  const renderer = new NeonGridRenderer(streams);

  renderer.start();
  renderer.emit({
    type: "session:start",
    runId: "neon-grid-run-123456",
    provider: "auto",
    model: "auto",
    root: "/tmp/open_multi-agent_kit",
    cwd: "/tmp/open_multi-agent_kit",
    rootSource: "cwd",
  });
  renderer.emit({ type: "prompt:ready" });
  renderer.emit({ type: "input:submitted", text: "route agents and verify evidence" });

  assert.equal(stdout.join(""), "");
  const output = stderr.join("");
  assert.match(output, /OMK\/\/CONTROL/);
  assert.match(output, /◢█ OMK\/\/CONTROL █◣/);
  assert.match(output, /OMK:\/\/CONTROL/);
  assert.doesNotMatch(output, /omk\+/i);
  assert.match(output, /CYBERPUNK OPS CORE/);
  assert.match(output, /MATRIX RAIN \/\/ NEON GRID ONLINE/);
  assert.match(output, /NIGHT-CITY-MATRIX-V3/);
  assert.match(output, /route · verify · loop · control/);
  assert.match(output, /state: ● ready/);
  assert.match(output, /ROUTE run#neon-g/);
  assert.match(output, /route agents and verify evidence/);
  assert.doesNotMatch(output, /Cyberpunk\s*2077|THE\s+MATRIX/i);
});
test("NeonGridRenderer renders root entry omk label when provided", () => {
  const { stderr, streams } = createStreams(92);
  const renderer = new NeonGridRenderer(streams);

  renderer.start();
  renderer.emit({
    type: "session:start",
    runId: "root-entry-run-123456",
    provider: "auto",
    model: "auto",
    root: "/tmp/open_multi-agent_kit",
    cwd: "/tmp/open_multi-agent_kit",
    rootSource: "cwd",
    brandLabel: "omk",
  });

  const output = stderr.join("");
  assert.match(output, /◢█ omk █◣/);
  assert.match(output, /omk:\/\/CONTROL/);
  assert.doesNotMatch(output, /◢█ OMK\/\/CONTROL █◣/);
});

test("chat UI resolver accepts neon-grid aliases", () => {
  assert.equal(resolveChatUi("neon-grid"), "neon-grid");
  assert.equal(resolveChatUi("neon"), "neon-grid");
  assert.equal(resolveChatUi("grid"), "neon-grid");
  assert.equal(resolveChatUi("control"), "neon-grid");
  assert.equal(resolveChatUi("night-city"), "neon-grid");
  assert.equal(resolveChatUi("metrics-control"), "neon-grid");
  assert.equal(resolveChatUi(undefined, { OMK_UI: "omk-control" }), "neon-grid");
});

test("branded chat entry defaults to the matching neon UI renderer", () => {
  assert.equal(defaultChatUiForBrand("neon-grid"), "neon-grid");
  assert.equal(defaultChatUiForBrand("green-rain"), "green-rain");
  assert.equal(defaultChatUiForBrand("rust-forge"), "rust-forge");
  assert.equal(defaultChatUiForBrand("omk"), "neon-grid");
});

test("neon-grid chat intro uses compact OMK Control copy", () => {
  const output = renderChatIntro("neon-grid", {
    agent: "root.yaml",
    runId: "neon-grid-intro",
    layout: "plain",
    trust: "bounded",
    mode: "agent",
  });

  assert.match(output, /OMK\/\/CONTROL ready/);
  assert.match(output, /OMK\/\/CONTROL/);
  assert.match(output, /OMK ONLINE/);
  assert.doesNotMatch(output, /GREEN\s+RAIN\s+MODE|THE\s+MATRIX/i);
});

test("default OMK chat intro uses Neon Grid copy instead of Matrix splash", () => {
  const output = renderChatIntro("omk", {
    agent: "root.yaml",
    runId: "default-intro",
    layout: "plain",
    trust: "bounded",
    mode: "agent",
  });

  assert.match(output, /OMK\/\/CONTROL/);
  assert.match(output, /OMK ONLINE/);
  assert.doesNotMatch(output, /GREEN\s+RAIN\s+MODE|THE\s+MATRIX/i);
});

test("NeonGridRenderer does not repaint sticky header unless explicitly enabled", async () => {
  const previousNoColor = process.env.NO_COLOR;
  const previousAnimation = process.env.OMK_ANIMATION;
  const previousHeaderRepaint = process.env.OMK_EXPERIMENTAL_HEADER_REPAINT;
  const previousAltScreen = process.env.OMK_TUI_ALT_SCREEN;
  const previousCi = process.env.CI;
  try {
    delete process.env.NO_COLOR;
    delete process.env.OMK_TUI_ALT_SCREEN;
    delete process.env.CI;
    process.env.OMK_ANIMATION = "full";
    delete process.env.OMK_EXPERIMENTAL_HEADER_REPAINT;
    const stable = createStreams(92, true);
    stable.streams.stderr.rows = 40;
    const stableRenderer = new NeonGridRenderer(stable.streams);
    stableRenderer.start();
    stableRenderer.emit({
      type: "session:start",
      runId: "neon-grid-stable",
      provider: "auto",
      model: "auto",
      root: "/tmp/open_multi-agent_kit",
      cwd: "/tmp/open_multi-agent_kit",
      rootSource: "cwd",
    });
    const stableWrites = stable.stderr.length;
    await new Promise((resolve) => setTimeout(resolve, 160));
    stableRenderer.stop();
    assert.equal(stable.stderr.length, stableWrites, "default mode must not write async cursor frames");

    process.env.OMK_EXPERIMENTAL_HEADER_REPAINT = "1";
    const { stderr, streams } = createStreams(92, true);
    streams.stderr.rows = 40;
    const renderer = new NeonGridRenderer(streams);
    renderer.start();
    renderer.emit({
      type: "session:start",
      runId: "neon-grid-animated",
      provider: "auto",
      model: "auto",
      root: "/tmp/open_multi-agent_kit",
      cwd: "/tmp/open_multi-agent_kit",
      rootSource: "cwd",
    });
    const initialWrites = stderr.length;
    await new Promise((resolve) => setTimeout(resolve, 160));
    renderer.stop();
    const repaintChunks = stderr.slice(initialWrites).join("");
    assert.match(repaintChunks, /\x1b\[1;1H/);
    assert.doesNotMatch(repaintChunks, /\n/);
  } finally {
    if (previousNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = previousNoColor;
    if (previousAnimation === undefined) delete process.env.OMK_ANIMATION; else process.env.OMK_ANIMATION = previousAnimation;
    if (previousHeaderRepaint === undefined) delete process.env.OMK_EXPERIMENTAL_HEADER_REPAINT; else process.env.OMK_EXPERIMENTAL_HEADER_REPAINT = previousHeaderRepaint;
    if (previousAltScreen === undefined) delete process.env.OMK_TUI_ALT_SCREEN; else process.env.OMK_TUI_ALT_SCREEN = previousAltScreen;
    if (previousCi === undefined) delete process.env.CI; else process.env.CI = previousCi;
  }
});

test("NeonGridRenderer honors NO_COLOR and clamps visible width", () => {
  const previousNoColor = process.env.NO_COLOR;
  const previousForceColor = process.env.FORCE_COLOR;
  try {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    const { stderr, streams } = createStreams(50, true);
    const renderer = new NeonGridRenderer(streams);
    renderer.start();
    renderer.emit({
      type: "session:start",
      runId: "neon-grid-accessible",
      provider: "auto",
      model: "very-long-model-name-that-should-be-truncated",
      root: "/tmp/open_multi-agent_kit/with/a/very/long/root/path",
      cwd: "/tmp/open_multi-agent_kit/with/a/very/long/root/path",
      rootSource: "cwd",
    });

    const output = stderr.join("");
    assert.doesNotMatch(output, /\x1b\[[0-9;]*m/);
    const visibleOutput = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    for (const line of visibleOutput.split("\n").filter(Boolean)) {
      assert.ok(line.length <= 48, `line exceeded width: ${line}`);
    }
  } finally {
    if (previousNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = previousNoColor;
    if (previousForceColor === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = previousForceColor;
  }
});
