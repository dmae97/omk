import { strictEqual, match, doesNotMatch } from "node:assert/strict";
import { test } from "node:test";

const { System24Renderer } = await import("../dist/cli/ui/system24-renderer.js");

test("System24Renderer renders the real prompt at prompt:ready instead of a fake post-turn input panel", () => {
  const stdout = [];
  const stderr = [];
  const renderer = new System24Renderer({
    stdout: { write: (chunk) => stdout.push(String(chunk)), columns: 80 },
    stderr: { write: (chunk) => stderr.push(String(chunk)), isTTY: false, columns: 80 },
  });

  renderer.start();
  renderer.emit({ type: "prompt:ready" });
  renderer.emit({ type: "input:submitted", text: "hello" });
  renderer.emit({ type: "turn:finish", durationMs: 1200, exitCode: 0 });

  strictEqual(stdout.join(""), "");
  const output = stderr.join("");
  match(output, /input/);
  match(output, /›/);
  match(output, /hello/);
  doesNotMatch(output, /type your message/);
  strictEqual((output.match(/input/g) ?? []).length, 1);
});

test("System24Renderer clamps tiny TTY widths instead of throwing", () => {
  const stdout = [];
  const stderr = [];
  const renderer = new System24Renderer({
    stdout: { write: (chunk) => stdout.push(String(chunk)), columns: 0 },
    stderr: { write: (chunk) => stderr.push(String(chunk)), isTTY: false, columns: 0 },
  });

  renderer.start();
  renderer.emit({ type: "prompt:ready" });
  renderer.emit({ type: "turn:finish", durationMs: 1, exitCode: 0 });

  strictEqual(stdout.join(""), "");
  match(stderr.join(""), /input/);
});

test("System24Renderer shows the active root in the session panel", () => {
  const stdout = [];
  const stderr = [];
  const renderer = new System24Renderer({
    stdout: { write: (chunk) => stdout.push(String(chunk)), columns: 100 },
    stderr: { write: (chunk) => stderr.push(String(chunk)), isTTY: false, columns: 100 },
  });

  renderer.start();
  renderer.emit({
    type: "session:start",
    runId: "chat-root-visibility",
    provider: "mimo",
    model: "mimo-v2.5-pro",
    root: "/tmp/current-bash-root",
    cwd: "/tmp/current-bash-root",
    rootSource: "cwd",
  });

  strictEqual(stdout.join(""), "");
  const output = stderr.join("");
  match(output, /root/);
  match(output, /current-bash-root/);
  match(output, /cwd/);
});
