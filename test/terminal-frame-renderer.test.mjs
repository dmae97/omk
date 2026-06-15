import test from "node:test";
import assert from "node:assert/strict";

import { TerminalFrameRenderer, clearTerminalScreen } from "../dist/tui/terminal-frame-renderer.js";

function createCapturedRenderer(options = {}) {
  const writes = [];
  const renderer = new TerminalFrameRenderer({
    mode: options.mode ?? "diff",
    height: options.height,
    scrollSafe: options.scrollSafe ?? true,
    write: (chunk) => writes.push(chunk),
    clear: () => writes.push("<clear>"),
  });
  return { renderer, writes };
}

test("diff mode is scroll-safe by default and does not emit cursor-home", () => {
  const { renderer, writes } = createCapturedRenderer({ mode: "diff" });

  renderer.render("alpha\nbeta");
  assert.doesNotMatch(writes[0], /\x1b\[H/);
  assert.equal(writes[0], "alpha\r\nbeta\r\n");

  renderer.render("alpha\ngamma");
  assert.doesNotMatch(writes[1], /\x1b\[H/);
  assert.equal(writes[1], "\x1b[1A\r\r\ngamma\x1b[K");

  renderer.render("alpha");
  assert.doesNotMatch(writes[2], /\x1b\[H/);
  assert.equal(writes[2], "\x1b[1A\r\r\n\x1b[K");
});

test("full mode is scroll-safe by default and appends instead of clear+home", () => {
  const { renderer, writes } = createCapturedRenderer({ mode: "full" });

  renderer.render("one\ntwo");

  assert.deepEqual(writes, ["one\ntwo\n"]);
});

test("full mode appends a separator between successive frames on main screen", () => {
  const { renderer, writes } = createCapturedRenderer({ mode: "full" });

  renderer.render("one\ntwo");
  renderer.render("three\nfour");

  assert.deepEqual(writes, ["one\ntwo\n", "\n\n", "three\nfour\n"]);
});

test("full mode does not append a trailing newline for fixed-height frames", () => {
  const { renderer, writes } = createCapturedRenderer({ mode: "full", height: 2 });

  renderer.render("one\ntwo");

  assert.deepEqual(writes, ["one\ntwo"]);
});

test("append mode writes complete frames without clearing", () => {
  const { renderer, writes } = createCapturedRenderer({ mode: "append" });

  renderer.render("one");
  renderer.render("two");

  assert.deepEqual(writes, ["one\n", "two\n"]);
});

test("alt-screen opt-in restores cursor-home and clear behavior", () => {
  const { renderer, writes } = createCapturedRenderer({ mode: "diff", scrollSafe: false });

  renderer.render("alpha\nbeta");
  renderer.render("alpha\ngamma");

  assert.equal(writes[0], "\x1b[Halpha\x1b[K\r\nbeta\x1b[K");
  assert.equal(writes[1], "\x1b[H\r\ngamma\x1b[K");
});

test("renderer mode can be changed between frames", () => {
  const { renderer, writes } = createCapturedRenderer({ mode: "diff" });

  renderer.render("one");
  renderer.mode = "full";
  renderer.render("two");

  assert.equal(writes[0], "one\r\n");
  assert.deepEqual(writes.slice(1), ["\n\n", "two\n"]);
});

test("clearTerminalScreen is scroll-safe by default", () => {
  const writes = [];
  clearTerminalScreen((chunk) => writes.push(chunk));
  assert.deepEqual(writes, ["\n\n"]);
});

test("clearTerminalScreen uses alt-screen sequences when scrollSafe is false", () => {
  const writes = [];
  clearTerminalScreen((chunk) => writes.push(chunk), false);
  assert.deepEqual(writes, ["\x1b[2J\x1b[H"]);
});
