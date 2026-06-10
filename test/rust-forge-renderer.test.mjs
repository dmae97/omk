import test from "node:test";
import assert from "node:assert/strict";

const { RustForgeRenderer } = await import("../dist/cli/ui/rust-forge-renderer.js");
const { resolveChatUi, renderChatIntro } = await import("../dist/commands/chat/utils.js");

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

function stripAnsi(value) {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

test("RustForgeRenderer renders OMK Rust Forge copy without provider-specific branding", () => {
  const { stdout, stderr, streams } = createStreams(92);
  const renderer = new RustForgeRenderer(streams);

  renderer.start();
  renderer.emit({
    type: "session:start",
    runId: "rust-forge-run-123456",
    provider: "auto",
    model: "auto",
    root: "/tmp/open_multi-agent_kit",
    cwd: "/tmp/open_multi-agent_kit",
    rootSource: "cwd",
  });
  renderer.emit({ type: "prompt:ready" });
  renderer.emit({ type: "input:submitted", text: "run cargo-native safety review" });

  assert.equal(stdout.join(""), "");
  const output = stderr.join("");
  assert.match(output, /OMK RUST FORGE/i);
  assert.match(output, /Forge the route\. Verify the evidence\. Control the loop\./);
  assert.match(output, /FORGE run#rust-fo/);
  assert.match(output, /FORGE route armed/);
  assert.match(output, /SCOPE MCP\/skills\/hooks/);
  assert.match(output, /run cargo-native safety review/);
  assert.doesNotMatch(output, /cargo install|crates\.io|rustup/i);
});

test("chat UI resolver accepts rust-forge aliases", () => {
  assert.equal(resolveChatUi("rust-forge"), "rust-forge");
  assert.equal(resolveChatUi("rust"), "rust-forge");
  assert.equal(resolveChatUi("cargo"), "rust-forge");
  assert.equal(resolveChatUi("oxide"), "rust-forge");
  assert.equal(resolveChatUi(undefined, { OMK_UI: "forge" }), "rust-forge");
});

test("RustForgeRenderer defaults to OMK wordmark and keeps forge override", () => {
  const previousSigil = process.env.OMK_SIGIL;
  const previousNoColor = process.env.NO_COLOR;
  const previousForceColor = process.env.FORCE_COLOR;
  try {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    delete process.env.OMK_SIGIL;

    const render = () => {
      const { stderr, streams } = createStreams(92);
      const renderer = new RustForgeRenderer(streams);
      renderer.start();
      renderer.emit({
        type: "session:start",
        runId: "rust-forge-sigil",
        provider: "auto",
        model: "auto",
        root: "/tmp/open_multi-agent_kit",
        cwd: "/tmp/open_multi-agent_kit",
        rootSource: "cwd",
      });
      return stripAnsi(stderr.join(""));
    };

    const defaultOutput = render();
    assert.match(defaultOutput, /██████╗/);
    assert.doesNotMatch(defaultOutput, /╭──────────────╮/);

    process.env.OMK_SIGIL = "forge";
    const forgeOutput = render();
    assert.match(forgeOutput, /╭──────────────╮/);
    assert.doesNotMatch(forgeOutput, /██████╗/);

    process.env.OMK_SIGIL = "omk";
    assert.match(render(), /██████╗/);
  } finally {
    if (previousSigil === undefined) delete process.env.OMK_SIGIL;
    else process.env.OMK_SIGIL = previousSigil;
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;
    if (previousForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = previousForceColor;
  }
});

test("rust-forge chat intro uses OMK Rust Forge copy", () => {
  const output = renderChatIntro("rust-forge", {
    agent: "root.yaml",
    runId: "rust-forge-intro",
    layout: "plain",
    trust: "bounded",
    mode: "agent",
  });

  assert.match(output, /OMK Rust Forge ready/);
  assert.match(output, /OMK\/\/RUST-FORGE/);
  assert.match(output, /OXIDIZED FORGE ONLINE/);
  assert.match(output, /METRICS \/\/ LIVE/);
  assert.doesNotMatch(output, /THE\s+MATRIX|kimi/i);
});

test("RustForgeRenderer honors NO_COLOR and clamps visible width", () => {
  const previousNoColor = process.env.NO_COLOR;
  const previousForceColor = process.env.FORCE_COLOR;
  try {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    const { stderr, streams } = createStreams(50, true);
    const renderer = new RustForgeRenderer(streams);
    renderer.start();
    renderer.emit({
      type: "session:start",
      runId: "rust-forge-accessible",
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
