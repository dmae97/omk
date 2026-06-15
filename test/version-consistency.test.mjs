import { ok, strictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const expectedVersion = pkg.version;

function runCheck(cwd) {
  return spawnSync(process.execPath, [join(process.cwd(), "scripts/check-version-consistency.mjs")], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function copyProjectTree(target) {
  const files = [
    "package.json",
    "package-lock.json",
    "src/version.ts",
    "CHANGELOG.md",
    "README.md",
    "MATURITY.md",
    "ROADMAP.md",
    "src/commands/init.ts",
    "src/commands/init/content.ts",
  ];
  const dirs = ["docs", "proof", "schemas", "src/brand", "themes"];
  for (const f of files) {
    try { cpSync(f, join(target, f)); } catch {}
  }
  for (const d of dirs) {
    try { cpSync(d, join(target, d), { recursive: true, force: true }); } catch {}
  }
}

test("version:check passes when theme omkVersion matches package version", () => {
  const result = runCheck(process.cwd());
  if (result.status !== 0) console.error(result.stdout, result.stderr);
  strictEqual(result.status, 0, `version:check failed: ${result.stderr}`);
  ok(result.stdout.includes("src/brand/rust-forge.theme.json"), result.stdout);
  ok(result.stdout.includes("themes/rust-forge.theme.json"), result.stdout);
});

test("version:check fails when theme omkVersion mismatches package version", () => {
  const tree = mkdtempSync(join(tmpdir(), "omk-theme-version-"));
  try {
    copyProjectTree(tree);
    const themePath = join(tree, "src/brand/rust-forge.theme.json");
    const theme = JSON.parse(readFileSync(themePath, "utf8"));
    theme.meta.omkVersion = "0.0.0-bad";
    writeFileSync(themePath, JSON.stringify(theme, null, 2), "utf8");

    const result = runCheck(tree);
    ok(result.status !== 0, "expected version:check to fail on theme mismatch");
    const output = `${result.stdout}\n${result.stderr}`;
    ok(output.includes("meta.omkVersion"), output);
    ok(output.includes("0.0.0-bad"), output);
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
});
