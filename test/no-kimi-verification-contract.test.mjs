import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("verify:no-kimi includes native non-smoke execution coverage", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const scripts = pkg.scripts ?? {};
  const verifyNoKimi = String(scripts["verify:no-kimi"] ?? "");
  const nativeTurn = String(scripts["native:no-kimi:turn"] ?? "");

  assert.match(verifyNoKimi, /native:no-kimi:turn/);
  assert.match(nativeTurn, /no-kimi-native-turn\.test\.mjs/);
  assert.doesNotMatch(nativeTurn, /--smoke/);
  assert.ok(
    verifyNoKimi
      .split("&&")
      .map((part) => part.trim())
      .some((part) => part.includes("native:no-kimi:turn") && !part.includes("smoke")),
    "verify:no-kimi must not remain smoke-only"
  );
});

test("release:check package contract includes no-Kimi, contract, proof, smoke, pack, and audit gates", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const scripts = pkg.scripts ?? {};
  const releaseCheck = String(scripts["release:check"] ?? "");
  const releaseCommands = releaseCheck
    .split("&&")
    .map((part) => part.trim())
    .filter(Boolean);
  const requiredGates = [
    "verify:no-kimi",
    "contract:check",
    "schema:check",
    "version:check",
    "proof:check",
    "smoke:execution",
    "pack:dry",
    "audit:package",
    "smoke:pack",
  ];

  for (const gate of requiredGates) {
    assert.ok(String(scripts[gate] ?? "").length > 0, `${gate} script must exist`);
    assert.ok(
      releaseCommands.includes(`npm run ${gate}`),
      `release:check must include npm run ${gate}`
    );
  }

  assert.match(String(scripts["verify:no-kimi"] ?? ""), /npm run native:no-kimi:turn/);
});
