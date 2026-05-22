import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SECRET_SCAN = join(process.cwd(), "scripts", "secret-scan.mjs");

test("runtime secret scan covers ignored .omk trust-boundary files without printing values", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-runtime-secret-scan-"));
  const secretValue = "fixture-runtime-value-that-must-not-print";
  const modernOpenAiKey = ["sk", "proj", "A".repeat(24)].join("-");
  const oauthSessionValue = `oauth-${"B".repeat(24)}`;
  try {
    spawnSync("git", ["init"], { cwd: projectRoot, encoding: "utf-8" });
    await writeFile(join(projectRoot, ".gitignore"), ".omk/\n", "utf-8");
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await mkdir(join(projectRoot, ".omk", "images"), { recursive: true });
    await mkdir(join(projectRoot, ".omk", "runs", "run-1"), { recursive: true });
    await writeFile(
      join(projectRoot, ".omk", "config.toml"),
      [
        `${["api", "_key"].join("")} = "${secretValue}"`,
        `${["openai", "_key"].join("")} = "${modernOpenAiKey}"`,
        `${["oauth", "_token"].join("")} = "${oauthSessionValue}"`,
        "",
      ].join("\n"),
      "utf-8"
    );
    await writeFile(
      join(projectRoot, ".omk", "images", "metadata.json"),
      `{"${["api", "_key"].join("")}":"${secretValue}"}\n`,
      "utf-8"
    );
    await writeFile(
      join(projectRoot, ".omk", "runs", "run-1", "state.json"),
      `{"${["api", "_key"].join("")}":"${secretValue}"}\n`,
      "utf-8"
    );

    const normal = spawnSync(process.execPath, [SECRET_SCAN], {
      cwd: projectRoot,
      encoding: "utf-8",
    });
    assert.equal(normal.status, 0, normal.stderr || normal.stdout);

    const runtime = spawnSync(process.execPath, [SECRET_SCAN, "--runtime"], {
      cwd: projectRoot,
      encoding: "utf-8",
    });
    assert.equal(runtime.status, 1, runtime.stderr || runtime.stdout);
    assert.match(runtime.stderr, /\.omk\/config\.toml/);
    assert.match(runtime.stderr, /\.omk\/images\/metadata\.json/);
    assert.match(runtime.stderr, /\.omk\/runs\/run-1\/state\.json/);
    assert.match(runtime.stderr, /openai_key/);
    assert.match(runtime.stderr, /oauth_session_token/);
    assert.doesNotMatch(runtime.stderr, new RegExp(secretValue));
    assert.doesNotMatch(runtime.stderr, new RegExp(modernOpenAiKey));
    assert.doesNotMatch(runtime.stderr, new RegExp(oauthSessionValue));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
