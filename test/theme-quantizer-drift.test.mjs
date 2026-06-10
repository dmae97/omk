import { describe, it } from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";

const { nearestXterm256 } = await import("../dist/cli/theme/oklab-quantize.js");
const { CUBE_LEVELS, quantizeXterm256, xterm256Hex } = await import("../scripts/theme-check.mjs");

const nightCity = JSON.parse(await readFile("themes/night-city.theme.json", "utf8"));
const nightCityHexes = Object.values(nightCity.primitives ?? {});

// Mulberry32 PRNG (fixed seed for determinism)
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

function assertSameIndex(hex, label) {
  const runtimeIndex = nearestXterm256(hex);
  const gateIndex = quantizeXterm256(hex).index;
  assert.strictEqual(
    runtimeIndex,
    gateIndex,
    `${label}: runtime ${runtimeIndex} !== gate ${gateIndex} for ${hex}`
  );
  assert.ok(runtimeIndex >= 16, `${label}: runtime emitted index <16 for ${hex}`);
  assert.ok(runtimeIndex <= 255, `${label}: runtime emitted index >255 for ${hex}`);
  assert.ok(gateIndex >= 16, `${label}: gate emitted index <16 for ${hex}`);
  assert.ok(gateIndex <= 255, `${label}: gate emitted index >255 for ${hex}`);
}

describe("theme quantizer twin-drift guard", () => {
  it("shares the exact cube levels and ramp constants", () => {
    assert.deepStrictEqual(CUBE_LEVELS, [0, 95, 135, 175, 215, 255]);
  });

  it("runtime dist contains the same cube levels constant", async () => {
    const runtimeSrc = await readFile("dist/cli/theme/oklab-quantize.js", "utf8");
    assert.ok(
      runtimeSrc.includes("const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];"),
      "runtime dist must contain the exact cube levels constant"
    );
    assert.ok(
      runtimeSrc.includes("8 + 10 * i"),
      "runtime dist must contain the grayscale ramp formula 8+10n"
    );
  });

  it("agrees on every primitive hex in night-city.theme.json", () => {
    assert.ok(nightCityHexes.length > 0, "night-city must have primitives");
    for (const hex of nightCityHexes) {
      assert.ok(/^#[0-9A-Fa-f]{6}$/.test(hex), `primitive ${hex} must be a 6-digit hex`);
      assertSameIndex(hex, "night-city primitive");
    }
  });

  it("round-trips all 240 xterm palette entries (indexes 16-255)", () => {
    for (let i = 16; i <= 255; i++) {
      const hex = xterm256Hex(i);
      const runtimeIndex = nearestXterm256(hex);
      const gateIndex = quantizeXterm256(hex).index;
      assert.strictEqual(
        runtimeIndex,
        gateIndex,
        `round-trip index ${i}: runtime ${runtimeIndex} !== gate ${gateIndex} for ${hex}`
      );
      assert.strictEqual(runtimeIndex, i, `runtime round-trip failed: ${hex} -> ${runtimeIndex} (expected ${i})`);
      assert.strictEqual(gateIndex, i, `gate round-trip failed: ${hex} -> ${gateIndex} (expected ${i})`);
    }
  });

  it("agrees on 64 seeded pseudo-random RGB values", () => {
    const rand = mulberry32(0xdeadbeef);
    for (let i = 0; i < 64; i++) {
      const r = Math.floor(rand() * 256);
      const g = Math.floor(rand() * 256);
      const b = Math.floor(rand() * 256);
      const hex = rgbToHex(r, g, b);
      assertSameIndex(hex, `seeded random #${i}`);
    }
  });
});
