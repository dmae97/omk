import test from "node:test";
import assert from "node:assert/strict";

const { GreenRainRenderer } = await import("../dist/cli/ui/green-rain-renderer.js");
const { resolveChatUi, renderChatIntro } = await import("../dist/commands/chat/utils.js");

function createStreams(columns = 80) {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    streams: {
      stdout: { write: (chunk) => stdout.push(String(chunk)), columns },
      stderr: { write: (chunk) => stderr.push(String(chunk)), isTTY: false, columns },
    },
  };
}

test("GreenRainRenderer renders an OMK-native control-plane header", () => {
  const { stdout, stderr, streams } = createStreams(92);
  const renderer = new GreenRainRenderer(streams);

  renderer.start();
  renderer.emit({
    type: "session:start",
    runId: "green-rain-run-123456",
    provider: "auto",
    model: "auto",
    root: "/tmp/open_multi-agent_kit",
    cwd: "/tmp/open_multi-agent_kit",
    rootSource: "cwd",
  });
  renderer.emit({ type: "prompt:ready" });
  renderer.emit({ type: "input:submitted", text: "verify the evidence" });

  assert.equal(stdout.join(""), "");
  const output = stderr.join("");
  assert.match(output, /OMK GREEN RAIN/);
  assert.match(output, /Follow the signal\. Verify the evidence\./);
  assert.match(output, /run#green-r/);
  assert.match(output, /verify the evidence/);
  assert.doesNotMatch(output, /THE\s+MATRIX/i);
});

test("chat UI resolver accepts green-rain aliases", () => {
  assert.equal(resolveChatUi("green-rain"), "green-rain");
  assert.equal(resolveChatUi("green"), "green-rain");
  assert.equal(resolveChatUi("matrix"), "green-rain");
  assert.equal(resolveChatUi(undefined, { OMK_UI: "rain" }), "green-rain");
});

test("green-rain chat intro keeps OMK Green Rain copy IP-safe", () => {
  const output = renderChatIntro("green-rain", {
    agent: "root.yaml",
    runId: "green-rain-intro",
    layout: "plain",
    trust: "bounded",
    mode: "agent",
  });

  assert.match(output, /OMK Green Rain ready/);
  assert.match(output, /GREEN\s+RAIN\s+MODE/);
  assert.doesNotMatch(output, /THE\s+MATRIX/i);
});
