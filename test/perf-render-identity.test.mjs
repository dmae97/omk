/**
 * Lane PERF-RENDER — behavior-preserving hot-path optimization proofs.
 *
 * Covers:
 *   P3#1 — cockpit body padding: O(n^2) per-iteration splice loop replaced by a
 *          single splice. Asserts the new construction is byte-identical to the
 *          original loop for arbitrary inputs (incl. an 800-line body) + bench.
 *   P3#2 — theme/layout box()/panel(): the redundant second ANSI strip (inside
 *          padEndAnsi) is eliminated by reusing a single per-line strip. Asserts
 *          output is byte-identical to the original (reference) implementation
 *          for representative inputs incl. ANSI codes and wide (CJK/emoji) chars.
 */
import { test } from "node:test";
import assert from "node:assert";
import { performance } from "node:perf_hooks";

const { box, panel, gradient } = await import("../dist/theme/layout.js");
const { stripAnsi, sanitizeTerminalText, visibleTerminalWidth, padEndAnsi } = await import("../dist/theme/ansi.js");
const { style } = await import("../dist/theme/colors.js");
const { renderCockpit } = await import("../dist/commands/cockpit/render.js");
const { CockpitRenderer } = await import("../dist/commands/cockpit/update-loop.js");

// ───────────────────────── Reference implementations (pre-edit "before") ─────────────────────────

/** Faithful copy of the ORIGINAL box() body, with the double strip via padEndAnsi. */
function refBox(lines, title) {
  const termWidth = process.stdout.columns || 80;
  const rawTitle = title ? sanitizeTerminalText(title) : "";
  const rawTitleWidth = rawTitle ? visibleTerminalWidth(rawTitle) : 0;
  const rawInner = Math.max(
    ...lines.map((l) => stripAnsi(l).length),
    rawTitle ? rawTitleWidth + 4 : 0
  );
  const innerWidth = Math.min(rawInner, Math.max(termWidth - 4, 20));
  const width = innerWidth + 4;
  const titleText = rawTitle ? style.phosphorBold(rawTitle) : "";
  const top = rawTitle
    ? style.phosphorDim("╔" + "═".repeat(2) + " ") + titleText + style.phosphorDim(" " + "═".repeat(Math.max(0, width - rawTitleWidth - 6)) + "╗")
    : style.phosphorDim("╔" + "═".repeat(width) + "╗");
  const bottom = style.phosphorDim("╚" + "═".repeat(width) + "╝");
  const body = lines.map((l) => style.phosphorDim("║ ") + padEndAnsi(l, innerWidth) + style.phosphorDim(" ║"));
  return [top, ...body, bottom].join("\n");
}

/** Faithful copy of the ORIGINAL panel() body, with the double strip via padEndAnsi. */
function refPanel(lines, title) {
  const termWidth = process.stdout.columns || 80;
  const rawTitle = title ? sanitizeTerminalText(title) : "";
  const rawTitleWidth = rawTitle ? visibleTerminalWidth(rawTitle) : 0;
  const rawInner = Math.max(...lines.map((l) => stripAnsi(l).length), rawTitle ? rawTitleWidth + 4 : 0);
  const innerWidth = Math.min(rawInner, Math.max(termWidth - 4, 20));
  const width = innerWidth + 4;
  const titleText = rawTitle ? gradient(rawTitle) : "";
  const top = rawTitle
    ? style.phosphorDim("┏" + "━".repeat(2) + " ") + titleText + style.phosphorDim(" " + "━".repeat(Math.max(0, width - rawTitleWidth - 6)) + "┓")
    : style.phosphorDim("┏" + "━".repeat(width) + "┓");
  const bottom = style.phosphorDim("┗" + "━".repeat(width) + "┛");
  const body = lines.map((l) => style.phosphorDim("┃ ") + padEndAnsi(l, innerWidth) + style.phosphorDim(" ┃"));
  return [top, ...body, bottom].join("\n");
}

// ───────────────────────── Splice transform: old loop vs new single-splice ─────────────────────────

/** Original O(n^2) per-iteration loop. */
function oldPad(body, h, bodyHeight) {
  const a = body.slice();
  while (a.length < bodyHeight) a.splice(h, 0, "");
  if (a.length > bodyHeight) a.length = bodyHeight;
  return a;
}

/** New single-splice construction (matches render.ts). */
function newPad(body, h, bodyHeight) {
  const a = body.slice();
  if (a.length < bodyHeight) {
    const padCount = bodyHeight - a.length;
    a.splice(h, 0, ...Array(padCount).fill(""));
  }
  if (a.length > bodyHeight) a.length = bodyHeight;
  return a;
}

// Representative panel inputs incl. ANSI codes + wide CJK/emoji chars.
const SAMPLE_TITLES = [undefined, "Run", "Workers & TODO", style.purple("Resources"), "한글 제목 ✦"];
const SAMPLE_LINE_SETS = [
  [],
  ["plain line"],
  ["short", "a much longer line that exceeds the others by a wide margin in width"],
  [style.mint("✓ clean worktree"), style.gray("  … 12 total"), style.red("✕ failed")],
  ["한글 텍스트 라인", "你好世界 mixed 123", "emoji 🚀🔥 line", style.blue("色付き ANSI 텍스트")],
  [style.purpleBold("M:3") + " " + style.gray("A:1"), "  ◆ src/theme/layout.ts", ""],
  ["x".repeat(200), style.cyan("y".repeat(120))],
];

test("P3#2 box() output is byte-identical to the reference (single vs double strip)", () => {
  for (const title of SAMPLE_TITLES) {
    for (const lines of SAMPLE_LINE_SETS) {
      const got = box(lines, title);
      const want = refBox(lines, title);
      assert.strictEqual(got, want, `box mismatch title=${JSON.stringify(title)} lines=${JSON.stringify(lines)}`);
    }
  }
});

test("P3#2 panel() output is byte-identical to the reference (single vs double strip)", () => {
  for (const title of SAMPLE_TITLES) {
    for (const lines of SAMPLE_LINE_SETS) {
      const got = panel(lines, title);
      const want = refPanel(lines, title);
      assert.strictEqual(got, want, `panel mismatch title=${JSON.stringify(title)} lines=${JSON.stringify(lines)}`);
    }
  }
});

test("P3#1 single-splice padding is byte-identical to the original loop", () => {
  const cases = [
    { body: ["a", "b", "c"], h: 0, bodyHeight: 8 },
    { body: ["a", "b", "c"], h: 2, bodyHeight: 8 },
    { body: ["a", "b", "c"], h: 3, bodyHeight: 3 },   // no padding needed
    { body: ["a", "b", "c", "d", "e"], h: 1, bodyHeight: 2 }, // truncation path
    { body: ["h1", "h2", "x", "y"], h: 2, bodyHeight: 50 },
    { body: Array.from({ length: 10 }, (_, i) => `row-${i}`), h: 5, bodyHeight: 800 },
  ];
  for (const c of cases) {
    assert.deepStrictEqual(
      newPad(c.body, c.h, c.bodyHeight),
      oldPad(c.body, c.h, c.bodyHeight),
      `pad mismatch h=${c.h} bodyHeight=${c.bodyHeight} len=${c.body.length}`,
    );
  }
});

test("P3#1 micro-bench: single-splice beats O(n^2) loop on an 800-line frame", () => {
  const body = Array.from({ length: 10 }, (_, i) => `row-${i}`);
  const h = 5;
  const bodyHeight = 800;
  const ITERS = 400;

  // sanity: identical result
  assert.deepStrictEqual(newPad(body, h, bodyHeight), oldPad(body, h, bodyHeight));

  const t0 = performance.now();
  for (let i = 0; i < ITERS; i++) oldPad(body, h, bodyHeight);
  const oldMs = performance.now() - t0;

  const t1 = performance.now();
  for (let i = 0; i < ITERS; i++) newPad(body, h, bodyHeight);
  const newMs = performance.now() - t1;

  // eslint-disable-next-line no-console
  console.log(`[perf-render] splice 800-line × ${ITERS}: old=${oldMs.toFixed(2)}ms new=${newMs.toFixed(2)}ms speedup=${(oldMs / newMs).toFixed(1)}x`);
  assert.ok(newMs < oldMs, `expected single-splice to be faster (old=${oldMs.toFixed(2)}ms new=${newMs.toFixed(2)}ms)`);
});

test("P3#1 integration: cockpit frame with renderer pads to bodyHeight without throwing", async () => {
  const renderer = new CockpitRenderer(1000, 18);
  const frame = await renderCockpit({ terminalWidth: 80, height: 18, quick: true, renderer, composerText: "draft", animFrame: 3 });
  assert.equal(typeof frame, "string");
  assert.ok(frame.length > 0, "frame should be non-empty");
  // Two renders with the same renderer/input stay structurally consistent.
  const frame2 = await renderCockpit({ terminalWidth: 80, height: 18, quick: true, renderer, composerText: "draft", animFrame: 3 });
  assert.equal(frame.split("\n").length, frame2.split("\n").length, "frame line count should be stable");
});
