import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getBundledOmkSafetyBinaryPath,
  getNativePlatformArchKey,
  getOmkSafetyBinaryName,
  resolveOmkSafetyNative,
} from "../dist/util/native-safety.js";

async function withTempRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "omk-native-loader-"));
  try {
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function touch(path) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "fixture", "utf-8");
}

test("native safety loader computes platform-arch keys and binary names", () => {
  assert.equal(getNativePlatformArchKey("linux", "x64"), "linux-x64");
  assert.equal(getNativePlatformArchKey("darwin", "arm64"), "darwin-arm64");
  assert.equal(getNativePlatformArchKey("win32", "x64"), "win32-x64");
  assert.equal(getOmkSafetyBinaryName("linux"), "omk-safety");
  assert.equal(getOmkSafetyBinaryName("win32"), "omk-safety.exe");
  assert.match(getBundledOmkSafetyBinaryPath("/pkg", "linux", "x64"), /\/pkg\/dist\/native\/linux-x64\/omk-safety$/);
});

test("native safety loader env override wins over bundled and target", async () => {
  await withTempRoot(async (root) => {
    const envPath = join(root, "custom", "omk-safety");
    const bundledPath = getBundledOmkSafetyBinaryPath(root, "linux", "x64");
    const targetPath = join(root, "target", "release", "omk-safety");
    touch(envPath);
    touch(bundledPath);
    touch(targetPath);

    const resolved = await resolveOmkSafetyNative({ root, packageRoot: root, platform: "linux", arch: "x64", env: { OMK_SAFETY_BIN: envPath } });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.source, "env");
    assert.equal(resolved.path, envPath);
  });
});

test("native safety loader prefers bundled over target fallback", async () => {
  await withTempRoot(async (root) => {
    const bundledPath = getBundledOmkSafetyBinaryPath(root, "linux", "x64");
    const targetPath = join(root, "target", "release", "omk-safety");
    touch(bundledPath);
    touch(targetPath);

    const resolved = await resolveOmkSafetyNative({ root, packageRoot: root, platform: "linux", arch: "x64", env: {} });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.source, "bundled");
    assert.equal(resolved.builtFromSource, false);
    assert.equal(resolved.path, bundledPath);
  });
});

test("native safety loader prefers release target over debug target", async () => {
  await withTempRoot(async (root) => {
    const releasePath = join(root, "target", "release", "omk-safety");
    const debugPath = join(root, "target", "debug", "omk-safety");
    touch(debugPath);
    touch(releasePath);

    const resolved = await resolveOmkSafetyNative({ root, packageRoot: root, platform: "linux", arch: "x64", env: {} });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.source, "target-release");
    assert.equal(resolved.builtFromSource, true);
    assert.equal(resolved.path, releasePath);
  });
});

test("native safety loader returns structured missing result", async () => {
  await withTempRoot(async (root) => {
    const resolved = await resolveOmkSafetyNative({ root, packageRoot: root, platform: "freebsd", arch: "riscv64", env: {} });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.source, "missing");
    assert.equal(resolved.path, null);
    assert.equal(resolved.platformArch, "freebsd-riscv64");
  });
});
