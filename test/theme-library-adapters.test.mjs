import test from "node:test";
import assert from "node:assert/strict";

const themeAdapters = await import("../dist/theme/external-theme-adapters.js");
const terminalKitBridge = await import("../dist/util/terminal-kit-bridge.js");
const screenshotStore = await import("../dist/util/screenshot-store.js");

test("external theme adapters register requested libraries", () => {
  const ids = themeAdapters.EXTERNAL_THEME_LIBRARY_ADAPTERS.map((adapter) => adapter.id);
  assert.deepEqual(ids, ["chalk-animation", "ink-gradient", "terminal-kit"]);
  const summary = themeAdapters.renderExternalThemeLibrarySummary();
  assert.match(summary, /chalk-animation/);
  assert.match(summary, /ink-gradient/);
  assert.match(summary, /terminal-kit/);
});

test("terminal-kit bridge exposes Ctrl+V text clipboard capabilities", () => {
  const capabilities = terminalKitBridge.getTerminalKitBridgeCapabilities();
  assert.equal(capabilities.available, true);
  assert.equal(capabilities.ctrlVPasteKey, true);
  assert.equal(capabilities.textClipboard, true);
  assert.equal(capabilities.imageClipboard, false);
  assert.equal(capabilities.windowsImageCapture, false);
  assert.equal(terminalKitBridge.isTerminalKitPasteKey("CTRL_V"), true);
  assert.equal(terminalKitBridge.isTerminalKitPasteKey("ENTER"), false);
});

test("screenshot capture capabilities distinguish Windows image bridge from terminal-kit text paste", () => {
  const caps = screenshotStore.listScreenshotCaptureCapabilities({
    platform: "linux",
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    procVersion: "",
  });
  const windows = caps.find((cap) => cap.name === "windows-clipboard-image");
  const terminalKit = caps.find((cap) => cap.name === "terminal-kit-ctrl-v-text");
  assert.equal(windows?.supported, true);
  assert.equal(windows?.mode, "image");
  assert.equal(terminalKit?.mode, "raw-key");
  assert.match(terminalKit?.note ?? "", /not image screenshots/);
});
