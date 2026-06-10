import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

const SVG_NAMES = [
  "omk-badges.svg",
  "omk-control-surfaces.svg",
  "omk-core-loop.svg",
  "omk-evidence-ledger.svg",
  "omk-logo-mark.svg",
  "omk-provider-lanes.svg",
  "omk-release-assertions.svg",
];

async function themeHash() {
  const bytes = await readFile("themes/night-city.theme.json");
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

async function setupTempRepo() {
  const tempRoot = await mkdtemp(join(tmpdir(), "omk-assets-check-"));
  await mkdir(join(tempRoot, "scripts"), { recursive: true });
  await mkdir(join(tempRoot, "themes"), { recursive: true });
  await mkdir(join(tempRoot, "readmeasset"), { recursive: true });
  await copyFile("scripts/assets-check.mjs", join(tempRoot, "scripts", "assets-check.mjs"));
  await copyFile("themes/night-city.theme.json", join(tempRoot, "themes", "night-city.theme.json"));
  await copyFile("readmeasset/ASSET_PROVENANCE.md", join(tempRoot, "readmeasset", "ASSET_PROVENANCE.md"));
  for (const name of SVG_NAMES) {
    await copyFile(join("readmeasset", name), join(tempRoot, "readmeasset", name));
  }
  return tempRoot;
}

function expectsDriftExit(err) {
  assert.equal(err.code, 1);
  assert.match(err.stderr, /provenance drift detected/);
  assert.match(err.stderr, /run: npm run assets:build && refresh ASSET_PROVENANCE\.md/);
  return true;
}

test("assets:check passes on the real repository", async () => {
  const result = await execFileAsync(process.execPath, ["scripts/assets-check.mjs"], {
    cwd: process.cwd(),
  });
  assert.match(result.stdout, /\[assets:check\] OK/);
  assert.equal(result.stderr, "");
});

test("assets:check fails when a ledger hash is tampered", async () => {
  const tempRoot = await setupTempRepo();
  try {
    const hash = await themeHash();
    const ledgerPath = join(tempRoot, "readmeasset", "ASSET_PROVENANCE.md");
    const original = await readFile(ledgerPath, "utf8");
    const tampered = original.replace(`@${hash}`, "@deadbeefcafe");
    assert.notEqual(tampered, original, "tamper precondition: theme hash must appear in ledger");
    await writeFile(ledgerPath, tampered, "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, ["scripts/assets-check.mjs"], { cwd: tempRoot }),
      expectsDriftExit,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("assets:check fails when a derived SVG is tampered", async () => {
  const tempRoot = await setupTempRepo();
  try {
    const svgPath = join(tempRoot, "readmeasset", "omk-badges.svg");
    const original = await readFile(svgPath, "utf8");
    await writeFile(svgPath, `${original}\n`, "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, ["scripts/assets-check.mjs"], { cwd: tempRoot }),
      expectsDriftExit,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("package.json wires assets:check to the verifier script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const scripts = pkg.scripts ?? {};
  assert.equal(String(scripts["assets:check"] ?? ""), "node scripts/assets-check.mjs");
});
