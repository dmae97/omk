import test from "node:test";
import assert from "node:assert/strict";

const { isUnsupportedRuntimeError, renderRouteBlockedPanel } = await import("../dist/cli/ui/route-blocked-panel.js");
const { PlainModernRenderer } = await import("../dist/cli/ui/plain-renderer.js");
const { System24Renderer } = await import("../dist/cli/ui/system24-renderer.js");

test("route blocked panel explains unsupported runtime errors", () => {
  const message = "No runtime supports task for node chat-turn";
  const output = renderRouteBlockedPanel(message, { width: 72 });

  assert.equal(isUnsupportedRuntimeError(message), true);
  assert.match(output, /ROUTE BLOCKED/);
  assert.match(output, /No runtime supports this task/);
  assert.match(output, /Node\s+chat-turn/);
  assert.match(output, /omk doctor/);
  assert.match(output, /\/provider auto/);
  assert.match(output, /\/mode plan/);
});

test("plain renderer renders unsupported runtime errors as recovery panels", () => {
  const stderr = [];
  const renderer = new PlainModernRenderer({
    stdout: { write: () => undefined },
    stderr: { write: (chunk) => stderr.push(String(chunk)), isTTY: false },
  });

  renderer.emit({ type: "turn:error", message: "No runtime supports task for node chat-turn" });

  const output = stderr.join("");
  assert.match(output, /ROUTE BLOCKED/);
  assert.match(output, /chat-turn/);
  assert.doesNotMatch(output, /✖ No runtime supports/);
});

test("system24 renderer renders unsupported runtime errors as recovery panels", () => {
  const stderr = [];
  const renderer = new System24Renderer({
    stdout: { write: () => undefined, columns: 80 },
    stderr: { write: (chunk) => stderr.push(String(chunk)), isTTY: false, columns: 80 },
  }, undefined, { noColor: true });

  renderer.start();
  renderer.emit({ type: "turn:error", message: "No runtime supports task for node chat-turn" });

  const output = stderr.join("");
  assert.match(output, /ROUTE BLOCKED/);
  assert.match(output, /chat-turn/);
  assert.doesNotMatch(output, /✖ No runtime supports/);
});
