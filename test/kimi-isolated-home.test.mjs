import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

import { cleanupIsolatedKimiHome, prepareIsolatedKimiHome, resolveOriginalHome } from "../dist/kimi/isolated-home.js";

const IS_WINDOWS = process.platform === "win32";

const execFileAsync = promisify(execFile);

test("original HOME resolution preserves the user's terminal home before isolation", () => {
  assert.equal(resolveOriginalHome({ HOME: "/terminal/home" }), "/terminal/home");
  assert.equal(resolveOriginalHome({ HOME: "/tmp/isolated", OMK_ORIGINAL_HOME: "/terminal/home" }), "/terminal/home");
});

test("isolated Kimi HOME inherits only minimal local terminal auth paths by default", async () => {
  const originalHome = await mkdtemp(join(tmpdir(), "omk-original-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-project-root-"));
  let isolatedHome;
  try {
    await mkdir(join(originalHome, ".kimi", "credentials"), { recursive: true });
    await mkdir(join(originalHome, ".codex"), { recursive: true });
    await mkdir(join(originalHome, ".config", "gh"), { recursive: true });
    await mkdir(join(originalHome, ".config", "omk"), { recursive: true });
    await writeFile(join(originalHome, ".kimi", "credentials", "kimi-code.json"), '{"token":"redacted"}');
    await writeFile(join(originalHome, ".codex", "auth.json"), '{"token":"redacted"}');
    await writeFile(join(originalHome, ".config", "gh", "hosts.yml"), "github.com: redacted");
    await writeFile(join(originalHome, ".config", "omk", "secrets.env"), "EXAMPLE_TOKEN=redacted");
    await writeFile(join(originalHome, ".netrc"), "machine example.invalid login redacted");
    await mkdir(join(originalHome, ".ssh"), { recursive: true });

    isolatedHome = await prepareIsolatedKimiHome({
      originalHome,
      projectRoot,
      env: {},
    });

    const codexLink = join(isolatedHome, ".codex");
    const ghLink = join(isolatedHome, ".config", "gh");
    const omkConfigLink = join(isolatedHome, ".config", "omk");
    const kimiCredentialsLink = join(isolatedHome, ".kimi", "credentials");

    if (!IS_WINDOWS) {
      assert.equal((await lstat(codexLink)).isSymbolicLink(), true);
      assert.equal((await lstat(ghLink)).isSymbolicLink(), true);
      assert.equal((await lstat(omkConfigLink)).isSymbolicLink(), true);
      assert.equal((await lstat(kimiCredentialsLink)).isSymbolicLink(), true);
      assert.equal(await readlink(codexLink), join(originalHome, ".codex"));
      assert.equal(await readlink(ghLink), join(originalHome, ".config", "gh"));
      assert.equal(await readlink(omkConfigLink), join(originalHome, ".config", "omk"));
      assert.equal(await readlink(kimiCredentialsLink), join(originalHome, ".kimi", "credentials"));
    }
    await assert.rejects(() => lstat(join(isolatedHome, ".netrc")));
    await assert.rejects(() => lstat(join(isolatedHome, ".ssh")));
  } finally {
    if (isolatedHome) await cleanupIsolatedKimiHome(isolatedHome);
    await rm(originalHome, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("isolated Kimi HOME supports trusted opt-in for broad local auth paths", async () => {
  const originalHome = await mkdtemp(join(tmpdir(), "omk-original-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-project-root-"));
  let isolatedHome;
  try {
    await mkdir(join(originalHome, ".ssh"), { recursive: true });
    await writeFile(join(originalHome, ".netrc"), "machine example.invalid login redacted");

    isolatedHome = await prepareIsolatedKimiHome({
      originalHome,
      projectRoot,
      env: { OMK_ISOLATED_HOME_AUTH_SCOPE: "trusted" },
    });

    if (!IS_WINDOWS) {
      assert.equal((await lstat(join(isolatedHome, ".ssh"))).isSymbolicLink(), true);
      assert.equal((await lstat(join(isolatedHome, ".netrc"))).isSymbolicLink(), true);
    }
  } finally {
    if (isolatedHome) await cleanupIsolatedKimiHome(isolatedHome);
    await rm(originalHome, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("isolated Kimi HOME does not synthesize temporary MCP config", async () => {
  const originalHome = await mkdtemp(join(tmpdir(), "omk-original-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-project-root-"));
  let isolatedHome;
  try {
    await mkdir(join(originalHome, ".kimi"), { recursive: true });
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await writeFile(
      join(originalHome, ".kimi", "mcp.json"),
      JSON.stringify({ mcpServers: { firecrawl: { command: "firecrawl" }, ok: { command: "ok" } } })
    );
    await writeFile(
      join(projectRoot, ".kimi", "mcp.json"),
      JSON.stringify({ mcpServers: { "omk-project": { command: "omk-project-mcp" } } })
    );

    isolatedHome = await prepareIsolatedKimiHome({
      originalHome,
      projectRoot,
      inheritLocalAuth: false,
      env: {},
    });

    await assert.rejects(() => readFile(join(isolatedHome, ".kimi", "mcp.json"), "utf-8"), /ENOENT/);
  } finally {
    if (isolatedHome) await cleanupIsolatedKimiHome(isolatedHome);
    await rm(originalHome, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("isolated Kimi HOME can disable local terminal auth inheritance", async () => {
  const originalHome = await mkdtemp(join(tmpdir(), "omk-original-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-project-root-"));
  let isolatedHome;
  try {
    await mkdir(join(originalHome, ".codex"), { recursive: true });
    await writeFile(join(originalHome, ".codex", "auth.json"), '{"token":"redacted"}');

    isolatedHome = await prepareIsolatedKimiHome({
      originalHome,
      projectRoot,
      inheritLocalAuth: false,
      env: {},
    });

    await assert.rejects(() => lstat(join(isolatedHome, ".codex")));
  } finally {
    if (isolatedHome) await cleanupIsolatedKimiHome(isolatedHome);
    await rm(originalHome, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("isolated Kimi HOME bridges shell profiles with original HOME", async () => {
  const originalHome = await mkdtemp(join(tmpdir(), "omk-original-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-project-root-"));
  let isolatedHome;
  try {
    await mkdir(join(originalHome, ".local", "bin"), { recursive: true });
    await mkdir(join(originalHome, ".cargo"), { recursive: true });
    await writeFile(join(originalHome, ".local", "bin", "env"), 'export OMK_LOCAL_BIN_ENV_HOME="$HOME"\n');
    await writeFile(join(originalHome, ".cargo", "env"), 'export OMK_CARGO_ENV_HOME="$HOME"\n');
    await writeFile(
      join(originalHome, ".profile"),
      [
        '. "$HOME/.local/bin/env"',
        '. "$HOME/.cargo/env"',
        'export OMK_PROFILE_FINAL_HOME="$HOME"',
        "",
      ].join("\n")
    );

    isolatedHome = await prepareIsolatedKimiHome({
      originalHome,
      projectRoot,
      env: { OMK_ISOLATED_HOME_BRIDGE_SHELL_PROFILES: "1" },
    });

    const profilePath = join(isolatedHome, ".profile");
    const profileStat = await lstat(profilePath);
    if (!IS_WINDOWS) {
      assert.equal(profileStat.isSymbolicLink(), false);
    }
    assert.match(await readFile(profilePath, "utf-8"), /OMK isolated HOME shell profile bridge/);

    const { stdout, stderr } = await execFileAsync(
      "bash",
      ["-lc", 'printf "%s|%s|%s|%s" "$HOME" "$OMK_LOCAL_BIN_ENV_HOME" "$OMK_CARGO_ENV_HOME" "$OMK_PROFILE_FINAL_HOME"'],
      {
        env: {
          HOME: isolatedHome,
          OMK_ORIGINAL_HOME: originalHome,
          PATH: process.env.PATH ?? "",
        },
      }
    );

    assert.equal(stderr, "");
    const [home, localBinHome, cargoHome, profileHome] = stdout.split("|");
    if (process.platform === "win32") {
      assert.equal(home.endsWith(basename(isolatedHome)), true);
    } else {
      assert.equal(home, isolatedHome);
    }
    assert.equal(localBinHome, originalHome);
    assert.equal(cargoHome, originalHome);
    assert.equal(profileHome, originalHome);
  } finally {
    if (isolatedHome) await cleanupIsolatedKimiHome(isolatedHome);
    await rm(originalHome, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
