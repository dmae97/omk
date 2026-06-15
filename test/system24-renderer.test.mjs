import { strictEqual, match, doesNotMatch } from "node:assert/strict";
import { test } from "node:test";

const { System24Renderer } = await import("../dist/cli/ui/system24-renderer.js");
const { NeonGridRenderer } = await import("../dist/cli/ui/neon-grid-renderer.js");
const { GreenRainRenderer } = await import("../dist/cli/ui/green-rain-renderer.js");
const { GREEN_RAIN_THEME } = await import("../dist/brand/theme.js");

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


test("System24Renderer accepts Green Rain theme tokens", () => {
  const stdout = [];
  const stderr = [];
  const renderer = new System24Renderer({
    stdout: { write: (chunk) => stdout.push(String(chunk)), columns: 100 },
    stderr: { write: (chunk) => stderr.push(String(chunk)), isTTY: false, columns: 100 },
  }, GREEN_RAIN_THEME, { noColor: false });

  renderer.start();
  renderer.emit({
    type: "session:start",
    runId: "green-rain-theme",
    provider: "auto",
    model: "auto",
    root: "/tmp/current-bash-root",
    cwd: "/tmp/current-bash-root",
    rootSource: "cwd",
  });

  strictEqual(stdout.join(""), "");
  const output = stderr.join("");
  match(output, /38;2;0;255;194m/);
  match(output, /OMK/);
});


test("System24Renderer brands heartbeat as concrete routed work", () => {
  const stdout = [];
  const stderr = [];
  const renderer = new System24Renderer({
    stdout: { write: (chunk) => stdout.push(String(chunk)), columns: 100 },
    stderr: { write: (chunk) => stderr.push(String(chunk)), isTTY: true, columns: 100 },
  }, GREEN_RAIN_THEME, { noColor: true });

  renderer.start();
  renderer.emit({ type: "turn:start" });
  renderer.emit({ type: "turn:heartbeat", elapsedMs: 1500, activity: "repo read · evidence gate · local ctx · auto" });

  strictEqual(stdout.join(""), "");
  const output = stderr.join("");
  match(output, /repo read/);
  match(output, /evidence gate/);
  doesNotMatch(output, /thinking\.\.\.|Working\.\.\./);
});


test("System24Renderer honors noColor output option", () => {
  const stdout = [];
  const stderr = [];
  const renderer = new System24Renderer({
    stdout: { write: (chunk) => stdout.push(String(chunk)), columns: 100 },
    stderr: { write: (chunk) => stderr.push(String(chunk)), isTTY: false, columns: 100 },
  }, GREEN_RAIN_THEME, { noColor: true });

  renderer.start();
  renderer.emit({
    type: "session:start",
    runId: "green-rain-no-color",
    provider: "auto",
    model: "auto",
    root: "/tmp/current-bash-root",
    cwd: "/tmp/current-bash-root",
    rootSource: "cwd",
  });

  strictEqual(stdout.join(""), "");
  doesNotMatch(stderr.join(""), /\x1b\[/);
});

test("System24Renderer stays scroll-stable by default and pins only when explicitly enabled", () => {
  const previousAltScreen = process.env.OMK_TUI_ALT_SCREEN;
  try {
    delete process.env.OMK_TUI_ALT_SCREEN;
    const defaultStderr = [];
    const defaultRenderer = new System24Renderer({
      stdout: { write: () => undefined, columns: 100, rows: 32 },
      stderr: { write: (chunk) => defaultStderr.push(String(chunk)), isTTY: true, columns: 100, rows: 32 },
    }, GREEN_RAIN_THEME, { noColor: false });
    defaultRenderer.start();
    defaultRenderer.emit({
      type: "session:start",
      runId: "stable-system24",
      provider: "codex",
      model: "codex-cli",
      root: "/tmp/current-bash-root",
      cwd: "/tmp/current-bash-root",
      rootSource: "cwd",
    });
    defaultRenderer.stop();
    doesNotMatch(defaultStderr.join(""), /\x1b\[\?1049h/);

    process.env.OMK_TUI_ALT_SCREEN = "1";
    const stdout = [];
    const stderr = [];
    const renderer = new System24Renderer({
      stdout: { write: (chunk) => stdout.push(String(chunk)), columns: 100, rows: 32 },
      stderr: { write: (chunk) => stderr.push(String(chunk)), isTTY: true, columns: 100, rows: 32 },
    }, GREEN_RAIN_THEME, { noColor: false });

    renderer.start();
    renderer.emit({
      type: "session:start",
      runId: "sticky-system24",
      provider: "codex",
      model: "codex-cli",
      root: "/tmp/current-bash-root",
      cwd: "/tmp/current-bash-root",
      rootSource: "cwd",
    });
    renderer.stop();

    const output = stderr.join("");
    match(output, /\x1b\[\?1049h/);
    match(output, /\x1b\[\d+;32r/);
    match(output, /\x1b\[\?1049l/);
  } finally {
    if (previousAltScreen === undefined) delete process.env.OMK_TUI_ALT_SCREEN;
    else process.env.OMK_TUI_ALT_SCREEN = previousAltScreen;
  }
});

test("System24Renderer skips pinned terminal controls for non-TTY and noColor", () => {
  for (const [isTTY, noColor] of [[false, false], [true, true]]) {
    const stderr = [];
    const renderer = new System24Renderer({
      stdout: { write: () => undefined, columns: 100, rows: 32 },
      stderr: { write: (chunk) => stderr.push(String(chunk)), isTTY, columns: 100, rows: 32 },
    }, GREEN_RAIN_THEME, { noColor });

    renderer.start();
    renderer.emit({
      type: "session:start",
      runId: "sticky-disabled",
      provider: "auto",
      model: "auto",
      root: "/tmp/current-bash-root",
      cwd: "/tmp/current-bash-root",
      rootSource: "cwd",
    });
    renderer.stop();

    const output = stderr.join("");
    doesNotMatch(output, /\x1b\[\?1049h/);
    doesNotMatch(output, /\x1b\[\d+;32r/);
  }
});

test("NeonGridRenderer and GreenRainRenderer include their brand header in the pinned region when opt-in", () => {
  const previousAltScreen = process.env.OMK_TUI_ALT_SCREEN;
  try {
    process.env.OMK_TUI_ALT_SCREEN = "1";
    for (const Renderer of [NeonGridRenderer, GreenRainRenderer]) {
      const stderr = [];
      const renderer = new Renderer({
        stdout: { write: () => undefined, columns: 100, rows: 40 },
        stderr: { write: (chunk) => stderr.push(String(chunk)), isTTY: true, columns: 100, rows: 40 },
      });

      renderer.start();
      renderer.emit({
        type: "session:start",
        runId: "sticky-brand-renderer",
        provider: "codex",
        model: "codex-cli",
        root: "/tmp/current-bash-root",
        cwd: "/tmp/current-bash-root",
        rootSource: "cwd",
      });
      renderer.stop();

      const output = stderr.join("");
      match(output, /\x1b\[\?1049h/);
      match(output, /\x1b\[(1[0-9]|2[0-9]);40r/);
      match(output, /\x1b\[\?1049l/);
    }
  } finally {
    if (previousAltScreen === undefined) delete process.env.OMK_TUI_ALT_SCREEN;
    else process.env.OMK_TUI_ALT_SCREEN = previousAltScreen;
  }
});
