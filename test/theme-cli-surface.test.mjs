/**
 * Theme contract T5a — CLI surface tests:
 *   - theme-doc loader/validator (omk.theme.v1 documents)
 *   - tier-explain (doctor "why" + NO_COLOR honored)
 *   - status-frame parity (preview renders the snapshot-gated frame)
 *   - ThemeCommand list/set/preview + DoctorCommand color section (Clipanion)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const { listThemeDocuments, loadThemeDocument, validateThemeDocument } = await import(
  "../dist/cli/theme/theme-doc.js"
);
const { explainColorTier } = await import("../dist/cli/theme/tier-explain.js");
const { renderStatusFrame } = await import("../dist/cli/theme/status-frame.js");
const { compileTheme } = await import("../dist/cli/theme/render-table.js");
const { createCliV2 } = await import("../dist/cli/v2/cli-v2-skeleton.js");

const theme = JSON.parse(await readFile(join(root, "themes", "night-city.theme.json"), "utf8"));

test("theme-doc discovers and validates night-city", () => {
  const docs = listThemeDocuments(root);
  assert.ok(docs.some((d) => d.name === "night-city"), "night-city document must be listed");
  const doc = loadThemeDocument("night-city", root);
  assert.ok(doc, "night-city document must load");
  assert.deepEqual(validateThemeDocument(doc), [], "night-city must validate cleanly");
  assert.equal(loadThemeDocument("no-such-theme", root), undefined);
});

test("validateThemeDocument flags structural violations", () => {
  const broken = structuredClone(theme);
  broken.semantics["route.active"].glyph = "";
  broken.fallback16["route.active"] = "notAColor";
  const errors = validateThemeDocument(broken);
  assert.ok(errors.some((e) => e.includes("missing mandatory glyph")), "glyph violation detected");
  assert.ok(errors.some((e) => e.includes("unknown ANSI-16 name")), "bad ansi16 name detected");
});

test("NO_COLOR glyph collision resolved: telemetry.info vs control.dim", () => {
  assert.notEqual(
    theme.semantics["telemetry.info"].glyph,
    theme.semantics["control.dim"].glyph,
    "logStream info vs dim must stay distinguishable at the NO_COLOR tier",
  );
});

test("magenta primitive is documented as reserved", () => {
  assert.ok(theme.primitives.magenta, "magenta primitive present");
  assert.ok(
    typeof theme.meta?.reservedPrimitives?.magenta === "string"
    && theme.meta.reservedPrimitives.magenta.length > 0,
    "unused magenta must be documented as reserved (t3-a11y-review SHOULD #4)",
  );
});

test("explainColorTier mirrors detection precedence and honors NO_COLOR", () => {
  const tty = true;
  const base = { TERM: "xterm-256color", COLORTERM: "truecolor" };
  assert.equal(explainColorTier([], base, tty).tier, "truecolor");
  assert.equal(explainColorTier([], { TERM: "xterm-256color" }, tty).tier, "256");
  assert.equal(explainColorTier([], { TERM: "xterm" }, tty).tier, "16");
  assert.equal(explainColorTier([], {}, false).tier, "no-color");

  const flagged = explainColorTier(["--no-color"], base, tty);
  assert.equal(flagged.tier, "no-color");
  assert.equal(flagged.noColorRequested, true);
  assert.equal(flagged.noColorHonored, true);
  assert.match(flagged.reasons[0], /--no-color/);

  const envNo = explainColorTier([], { ...base, NO_COLOR: "1" }, tty);
  assert.equal(envNo.tier, "no-color");
  assert.equal(envNo.noColorHonored, true);
  assert.match(envNo.reasons[0], /NO_COLOR/);

  const force = explainColorTier([], { FORCE_COLOR: "3" }, tty);
  assert.equal(force.tier, "256");
  assert.match(force.reasons[0], /FORCE_COLOR=3/);
});

test("status-frame module renders the snapshot frame (no-color tier)", () => {
  const frame = renderStatusFrame(compileTheme(theme, "no-color"));
  assert.equal(
    frame,
    "◆ OMK//CONTROL ┊ night-city ops console\n"
    + "▶ lane compile  ● lane schema  ◌ lane docs\n"
    + "✓ contrast 48/48  ◐ snapshots  ↻ provider kimi\n"
    + "▲ headroom 81%  tier ready",
  );
});

async function runCli(args, cwd) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let errOut = "";
  stdout.on("data", (c) => { out += String(c); });
  stderr.on("data", (c) => { errOut += String(c); });
  const cli = createCliV2();
  const code = await cli.run(args, { stdout, stderr, stdin: process.stdin });
  return { code, out, errOut };
}

test("omk theme list shows active theme and night-city document", async () => {
  const { code, out } = await runCli(["theme", "list", "--cwd", root, "--no-color"]);
  assert.equal(code, 0);
  assert.match(out, /Active theme: /);
  assert.match(out, /Theme documents \(omk\.theme\.v1\):/);
  assert.match(out, /night-city — .*night-city\.theme\.json \(valid\)/);
});

test("omk theme set persists a validated choice and rejects unknown names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omk-theme-set-"));
  const savedEnv = process.env.OMK_THEME;
  try {
    const ok = await runCli(["theme", "set", "night-city", "--cwd", dir]);
    assert.equal(ok.code, 0);
    const cfg = JSON.parse(await readFile(join(dir, ".omkrc.json"), "utf8"));
    assert.equal(cfg.theme, "night-city");

    const bad = await runCli(["theme", "set", "definitely-not-a-theme", "--cwd", dir]);
    assert.equal(bad.code, 2);
    assert.match(bad.errOut, /Unknown theme/);
  } finally {
    if (savedEnv === undefined) delete process.env.OMK_THEME;
    else process.env.OMK_THEME = savedEnv;
    await rm(dir, { recursive: true, force: true });
  }
});

test("omk theme preview renders the representative frame at the detected tier", async () => {
  const { code, out } = await runCli(["theme", "preview", "night-city", "--cwd", root, "--no-color"]);
  assert.equal(code, 0);
  assert.match(out, /tier no-color/);
  assert.ok(out.includes("◆ OMK//CONTROL ┊ night-city ops console"), "preview must contain the snapshot frame");
  assert.ok(!out.includes("\u001b["), "no-color preview must not emit escape sequences");
});

test("omk doctor reports color tier, theme, and NO_COLOR honored", async () => {
  const { code, out } = await runCli(["doctor", "--cwd", root, "--no-color"]);
  assert.equal(code, 0);
  assert.match(out, /Color tier & theme/);
  assert.match(out, /detected tier : no-color/);
  assert.match(out, /why\s+: --no-color CLI flag/);
  assert.match(out, /NO_COLOR\s+: requested=yes honored=yes/);
  assert.match(out, /active theme {2}: /);
  assert.match(out, /theme schema {2}: /);
});
