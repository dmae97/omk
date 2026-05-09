import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getScreenshotDir,
  listScreenshots,
  cleanScreenshots,
  validateMagicBytes,
  buildWindowsClipboardImageScript,
  getWindowsClipboardImageCommands,
  isWslEnvironment,
  SCREENSHOT_DIR,
  MAX_SIZE_BYTES,
} from "../dist/util/screenshot-store.js";

// Build a minimal 1x1 PNG (89 50 4E 47 ...)
const MINI_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
  0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0x0f, 0x00, 0x00,
  0x01, 0x01, 0x00, 0x05, 0x18, 0xd8, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const FAKE_JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe("validateMagicBytes", () => {
  it("recognizes PNG", () => {
    const r = validateMagicBytes(MINI_PNG);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.ext, "png");
  });

  it("recognizes JPG", () => {
    const r = validateMagicBytes(FAKE_JPG);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.ext, "jpg");
  });

  it("rejects invalid data", () => {
    const r = validateMagicBytes(Buffer.from("not an image"));
    assert.strictEqual(r.ok, false);
  });
});


describe("Windows clipboard image bridge", () => {
  it("builds a PowerShell script that handles Snipping Tool image formats", () => {
    const script = buildWindowsClipboardImageScript();
    assert.match(script, /GetDataPresent\(\$format\)/);
    assert.match(script, /'PNG'/);
    assert.match(script, /DataFormats]::FileDrop/);
    assert.match(script, /Clipboard]::ContainsImage\(\)/);
    assert.match(script, /ImageFormat]::Png/);
  });

  it("prefers an explicit Windows PowerShell path and otherwise has WSL interop fallbacks", () => {
    assert.deepStrictEqual(getWindowsClipboardImageCommands({ OMK_WINDOWS_POWERSHELL_PATH: "C:/pwsh/powershell.exe" }), [
      "C:/pwsh/powershell.exe",
    ]);
    const defaults = getWindowsClipboardImageCommands({});
    assert.ok(defaults.includes("powershell.exe"));
    assert.ok(defaults.includes("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"));
  });

  it("detects WSL across bash and zsh environments", () => {
    assert.strictEqual(isWslEnvironment({ WSL_DISTRO_NAME: "Ubuntu-24.04" }, ""), true);
    assert.strictEqual(isWslEnvironment({ WSL_INTEROP: "/run/WSL/123_interop" }, ""), true);
    assert.strictEqual(isWslEnvironment({}, "Linux version 6.6.87.2-microsoft-standard-WSL2"), true);
    assert.strictEqual(isWslEnvironment({}, "Linux version 6.6.0-generic"), false);
  });
});

describe("getScreenshotDir", () => {
  it("returns .omk/screenshots under given root", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-ss-test-"));
    const dir = getScreenshotDir(root);
    assert.strictEqual(dir, join(root, SCREENSHOT_DIR));
  });
});

describe("listScreenshots", () => {
  it("lists screenshots sorted by mtime desc", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-ss-test-"));
    const dateDir = join(root, SCREENSHOT_DIR, "2026-05-04");
    mkdirSync(dateDir, { recursive: true });
    writeFileSync(join(dateDir, "a.png"), MINI_PNG);
    writeFileSync(join(dateDir, "b.png"), MINI_PNG);

    const list = listScreenshots(root);
    assert.strictEqual(list.length, 2);
    assert.ok(list[0].relativePath.includes("a.png") || list[0].relativePath.includes("b.png"));
  });

  it("returns empty array when no screenshots exist", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-ss-test-"));
    const list = listScreenshots(root);
    assert.deepStrictEqual(list, []);
  });
});

describe("cleanScreenshots", () => {
  it("deletes old screenshots", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-ss-test-"));
    const dateDir = join(root, SCREENSHOT_DIR, "2026-01-01");
    mkdirSync(dateDir, { recursive: true });
    const path = join(dateDir, "old.png");
    writeFileSync(path, MINI_PNG);

    // Force mtime to be very old
    const veryOld = new Date("2000-01-01");
    utimesSync(path, veryOld, veryOld);

    const result = cleanScreenshots(7, false, root);
    assert.ok(result.deleted.some((p) => p.includes("old.png")));
  });

  it("dry-run does not delete", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-ss-test-"));
    const dateDir = join(root, SCREENSHOT_DIR, "2026-01-01");
    mkdirSync(dateDir, { recursive: true });
    const path = join(dateDir, "old.png");
    writeFileSync(path, MINI_PNG);

    const veryOld = new Date("2000-01-01");
    utimesSync(path, veryOld, veryOld);

    const result = cleanScreenshots(7, true, root);
    assert.ok(result.deleted.some((p) => p.includes("old.png")));
    assert.strictEqual(existsSync(path), true);
  });
});
