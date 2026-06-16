import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

test("default control-plane surface contains no KIMI tokens", async () => {
  const result = await execFileAsync(process.execPath, ["scripts/no-kimi-default-surface.mjs"], {
    cwd: process.cwd(),
  });

  assert.match(result.stdout, /provider-neutral/);
  assert.equal(result.stderr, "");
});

test("release gate includes the no-KIMI default-surface check", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const scripts = pkg.scripts ?? {};

  assert.match(String(scripts["verify:no-kimi"] ?? ""), /no-kimi:default-surface/);
  assert.match(String(scripts["release:check"] ?? ""), /release:gate-core/);
  assert.match(String(scripts["release:gate-core"] ?? ""), /verify:no-kimi/);
});
