import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { cleanupIsolatedKimiHome, prepareIsolatedKimiHome, resolveOriginalHome } from "../dist/kimi/isolated-home.js";

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

    assert.equal((await lstat(codexLink)).isSymbolicLink(), true);
    assert.equal((await lstat(ghLink)).isSymbolicLink(), true);
    assert.equal((await lstat(omkConfigLink)).isSymbolicLink(), true);
    assert.equal((await lstat(kimiCredentialsLink)).isSymbolicLink(), true);
    assert.equal(await readlink(codexLink), join(originalHome, ".codex"));
    assert.equal(await readlink(ghLink), join(originalHome, ".config", "gh"));
    assert.equal(await readlink(omkConfigLink), join(originalHome, ".config", "omk"));
    assert.equal(await readlink(kimiCredentialsLink), join(originalHome, ".kimi", "credentials"));
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

    assert.equal((await lstat(join(isolatedHome, ".ssh"))).isSymbolicLink(), true);
    assert.equal((await lstat(join(isolatedHome, ".netrc"))).isSymbolicLink(), true);
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
