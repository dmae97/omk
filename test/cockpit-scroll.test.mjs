import { describe, it } from "node:test";
import assert from "node:assert";

const scroll = await import("../dist/commands/cockpit/scroll.js");
const { computeCockpitLayout } = await import("../dist/commands/cockpit/utils.js");
const { CockpitRenderer } = await import("../dist/commands/cockpit/update-loop.js");
const { renderCockpit } = await import("../dist/commands/cockpit/render.js");

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("cockpit left-pane scroll", () => {
  it("parseSgrWheelEvents parses SGR wheel up", () => {
    assert.deepEqual(scroll.parseSgrWheelEvents("\x1b[<64;10;20M"), [
      { x: 10, y: 20, deltaY: -1, shiftKey: false, altKey: false, ctrlKey: false },
    ]);
  });

  it("parseSgrWheelEvents parses SGR wheel down", () => {
    assert.deepEqual(scroll.parseSgrWheelEvents("\x1b[<65;10;20M"), [
      { x: 10, y: 20, deltaY: 1, shiftKey: false, altKey: false, ctrlKey: false },
    ]);
  });

  it("parses SGR wheel up/down events", () => {
    const events = scroll.parseSgrWheelEvents("\x1b[<64;10;5M\x1b[<65;10;5M");
    assert.deepEqual(events, [
      { x: 10, y: 5, deltaY: -1, shiftKey: false, altKey: false, ctrlKey: false },
      { x: 10, y: 5, deltaY: 1, shiftKey: false, altKey: false, ctrlKey: false },
    ]);
  });

  it("slices transcript lines from bottom with padding", () => {
    assert.deepEqual(scroll.sliceFromBottom({ lines: ["a", "b", "c"], viewportHeight: 5, scrollFromBottom: 0 }), ["", "", "a", "b", "c"]);
    assert.deepEqual(scroll.sliceFromBottom({ lines: ["a", "b", "c", "d", "e"], viewportHeight: 2, scrollFromBottom: 1 }), ["c", "d"]);
  });

  it("routes wheel over left pane to renderer scroll state", async () => {
    const renderer = new CockpitRenderer(1000, 14);
    await renderCockpit({ terminalWidth: 80, height: 14, quick: true, renderer });

    assert.ok(renderer.currentLayout, "render should set currentLayout");
    assert.ok(renderer.lastLeftLineCount > renderer.lastTranscriptHeight, "test fixture should have scrollable left content");

    const x = renderer.currentLayout.transcript.x;
    const y = renderer.currentLayout.transcript.y;
    const handled = renderer.handleWheel(x, y, -1);

    assert.equal(handled, true);
    assert.equal(renderer.leftScrollFromBottom, 6);
    assert.equal(renderer.followTail, false);
  });

  it("raw wheel over transcript is consumed before keyboard/composer fallback", async () => {
    const renderer = new CockpitRenderer(1000, 14);
    await renderCockpit({ terminalWidth: 80, height: 14, quick: true, renderer });

    let keyHandlerCalls = 0;
    renderer.keyHandler = () => {
      keyHandlerCalls += 1;
    };

    const x = renderer.currentLayout.transcript.x;
    const y = renderer.currentLayout.transcript.y;
    renderer.handleStdin(Buffer.from(`\x1b[<64;${x};${y}M`, "utf8"));

    assert.equal(keyHandlerCalls, 0);
    assert.equal(renderer.leftScrollFromBottom, 6);
    assert.equal(renderer.followTail, false);
    assert.equal(renderer.resized, true);
  });

  it("raw wheel over composer is consumed before keyboard/composer fallback and scrolls transcript", async () => {
    const renderer = new CockpitRenderer(1000, 16);
    await renderCockpit({ terminalWidth: 80, height: 16, quick: true, renderer, composerText: "draft prompt must stay sticky" });

    let keyHandlerCalls = 0;
    renderer.keyHandler = () => {
      keyHandlerCalls += 1;
    };

    const x = renderer.currentLayout.composer.x;
    const y = renderer.currentLayout.composer.y;
    renderer.handleStdin(Buffer.from(`\x1b[<64;${x};${y}M`, "utf8"));

    assert.equal(keyHandlerCalls, 0);
    assert.equal(renderer.leftScrollFromBottom, 6);
    assert.equal(renderer.followTail, false);
  });

  it("raw wheel outside left pane is still consumed before keyboard/composer fallback", async () => {
    const renderer = new CockpitRenderer(1000, 14);
    await renderCockpit({ terminalWidth: 80, height: 14, quick: true, renderer });

    let keyHandlerCalls = 0;
    renderer.keyHandler = () => {
      keyHandlerCalls += 1;
    };

    renderer.handleStdin(Buffer.from("\x1b[<64;500;500M", "utf8"));

    assert.equal(keyHandlerCalls, 0);
    assert.equal(renderer.leftScrollFromBottom, 0);
  });

  it("PageUp/PageDown/Home/End route to transcript scroll before keyboard/composer fallback", async () => {
    const renderer = new CockpitRenderer(1000, 14);
    await renderCockpit({ terminalWidth: 80, height: 14, quick: true, renderer });

    let keyHandlerCalls = 0;
    renderer.keyHandler = () => {
      keyHandlerCalls += 1;
    };

    const max = Math.max(0, renderer.lastLeftLineCount - renderer.lastTranscriptHeight);
    const step = Math.max(1, renderer.lastTranscriptHeight - 3);

    renderer.handleStdin(Buffer.from("\x1b[5~", "utf8"));
    assert.equal(keyHandlerCalls, 0);
    assert.equal(renderer.leftScrollFromBottom, Math.min(max, step));
    assert.equal(renderer.followTail, renderer.leftScrollFromBottom === 0);

    renderer.handleStdin(Buffer.from("\x1b[H", "utf8"));
    assert.equal(keyHandlerCalls, 0);
    assert.equal(renderer.leftScrollFromBottom, max);
    assert.equal(renderer.followTail, max === 0);

    renderer.handleStdin(Buffer.from("\x1b[6~", "utf8"));
    assert.equal(keyHandlerCalls, 0);
    assert.equal(renderer.leftScrollFromBottom, Math.max(0, max - step));

    renderer.handleStdin(Buffer.from("\x1b[F", "utf8"));
    assert.equal(keyHandlerCalls, 0);
    assert.equal(renderer.leftScrollFromBottom, 0);
    assert.equal(renderer.followTail, true);
  });

  it("preserves scrolled viewport when new left transcript lines arrive", async () => {
    const renderer = new CockpitRenderer(1000, 14);
    await renderCockpit({ terminalWidth: 80, height: 14, quick: true, renderer });

    renderer.leftScrollFromBottom = 5;
    renderer.followTail = false;
    renderer.lastLeftLineCount = Math.max(0, renderer.lastLeftLineCount - 3);

    await renderCockpit({ terminalWidth: 80, height: 14, quick: true, renderer });

    assert.equal(renderer.leftScrollFromBottom, 8);
  });
  it("snaps to latest transcript output when followTail is true", async () => {
    const renderer = new CockpitRenderer(1000, 14);
    await renderCockpit({ terminalWidth: 80, height: 14, quick: true, renderer });

    renderer.leftScrollFromBottom = 7;
    renderer.followTail = true;
    renderer.lastLeftLineCount = Math.max(0, renderer.lastLeftLineCount - 3);

    await renderCockpit({ terminalWidth: 80, height: 14, quick: true, renderer });

    assert.equal(renderer.leftScrollFromBottom, 0);
    assert.equal(renderer.followTail, true);
  });

  it("render transcript excludes composerText from scroll source", async () => {
    const renderer = new CockpitRenderer(1000, 16);
    await renderCockpit({ terminalWidth: 80, height: 16, quick: true, renderer });
    const withoutComposerCount = renderer.leftTranscriptLineCount;

    await renderCockpit({ terminalWidth: 80, height: 16, quick: true, renderer, composerText: "UNIQUE-COMPOSER-DRAFT" });

    assert.equal(renderer.leftTranscriptLineCount, withoutComposerCount);
  });

  it("keeps composer and working sweep sticky while transcript scroll changes", async () => {
    const renderer = new CockpitRenderer(1000, 18);
    const atTail = stripAnsi(await renderCockpit({ terminalWidth: 80, height: 18, quick: true, renderer, composerText: "sticky draft", animFrame: 5 }));
    const tailLines = atTail.split("\n");
    const composerAtTail = tailLines.find((line) => line.includes("composer") && line.includes("sticky draft"));
    const workingAtTail = tailLines.find((line) => line.includes("WORKING"));

    renderer.leftScrollFromBottom = 5;
    renderer.followTail = false;

    const scrolled = stripAnsi(await renderCockpit({ terminalWidth: 80, height: 18, quick: true, renderer, composerText: "sticky draft", animFrame: 5 }));
    const scrolledLines = scrolled.split("\n");
    const composerAfterScroll = scrolledLines.find((line) => line.includes("composer") && line.includes("sticky draft"));
    const workingAfterScroll = scrolledLines.find((line) => line.includes("WORKING"));

    assert.ok(composerAtTail, "composer should render as sticky chrome");
    assert.equal(composerAfterScroll, composerAtTail);
    assert.ok(workingAtTail, "working sweep should render as sticky chrome");
    assert.equal(workingAfterScroll, workingAtTail);
  });

  it("keeps footer fixed outside the scrollable left transcript", async () => {
    const renderer = new CockpitRenderer(1000, 14);
    const atTail = await renderCockpit({ terminalWidth: 80, height: 14, quick: true, renderer });
    const footerAtTail = stripAnsi(atTail).split("\n").at(-2);

    renderer.leftScrollFromBottom = 5;
    renderer.followTail = false;

    const scrolled = await renderCockpit({ terminalWidth: 80, height: 14, quick: true, renderer });
    const footerAfterScroll = stripAnsi(scrolled).split("\n").at(-2);

    assert.match(footerAtTail ?? "", /\[h\]istory|\[q\]uit/);
    assert.equal(footerAfterScroll, footerAtTail);
  });

  it("right rail layout stays pinned outside left transcript scrolling", () => {
    const layout = computeCockpitLayout({
      cols: 140,
      rows: 36,
      rightRailPinned: true,
      composerHeight: 3,
      workingHeight: 2,
      composerLiftRows: 0,
    });

    assert.ok(layout.rightRail, "right rail should exist on wide pinned layout");
    assert.equal(layout.rightRail.x + layout.rightRail.w - 1, 140);
    assert.equal(layout.footer.y, 36);
    assert.ok(layout.transcript.y < layout.working.y);
    assert.ok(layout.working.y < layout.composer.y);
  });
});
