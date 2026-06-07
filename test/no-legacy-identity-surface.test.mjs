import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

test("default OMK public surface contains no legacy identity markers", async () => {
  const result = await execFileAsync(process.execPath, ["scripts/no-legacy-identity-surface.mjs"], {
    cwd: process.cwd(),
  });

  assert.match(result.stdout, /no legacy identity markers/);
  assert.equal(result.stderr, "");
});

test("legacy identity surface check rejects old public markers", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "omk-legacy-identity-"));
  try {
    await mkdir(join(tempRoot, "scripts"), { recursive: true });
    await copyFile("scripts/no-legacy-identity-surface.mjs", join(tempRoot, "scripts", "no-legacy-identity-surface.mjs"));
    const product = [80, 105].map((code) => String.fromCharCode(code)).join("");
    await writeFile(join(tempRoot, "README.md"), `${product} public marker\n`, "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, ["scripts/no-legacy-identity-surface.mjs"], { cwd: tempRoot }),
      /legacy identity markers/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("legacy identity surface check scans untracked top-level docs", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "omk-legacy-identity-doc-"));
  try {
    await mkdir(join(tempRoot, "scripts"), { recursive: true });
    await copyFile("scripts/no-legacy-identity-surface.mjs", join(tempRoot, "scripts", "no-legacy-identity-surface.mjs"));
    const product = [80, 105].map((code) => String.fromCharCode(code)).join("").toLowerCase();
    await writeFile(join(tempRoot, "codex-oauth-setup.md"), `legacy home: ~/.${product}/agent/auth.json\n`, "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, ["scripts/no-legacy-identity-surface.mjs"], { cwd: tempRoot }),
      /codex-oauth-setup\.md/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("verify gate includes the legacy identity surface check", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const scripts = pkg.scripts ?? {};

  assert.match(String(scripts.verify ?? ""), /legacy-identity:check/);
  assert.equal(String(scripts["legacy-identity:check"] ?? ""), "node scripts/no-legacy-identity-surface.mjs");
});
