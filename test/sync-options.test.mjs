import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const OMK_ROOT = process.cwd();
const SYNC_MODULE = pathToFileURL(join(OMK_ROOT, "dist", "commands", "sync.js")).href;
const FS_MODULE = pathToFileURL(join(OMK_ROOT, "dist", "util", "fs.js")).href;

function runSyncInTemp(opts) {
  const tmpDir = mkdtempSync(join(tmpdir(), "omk-sync-"));
  const script = `
    import { syncCommand } from "${SYNC_MODULE}";
    await syncCommand(${JSON.stringify(opts)});
    console.log("SYNC_OK");
  `;
  return spawnSync(process.execPath, ["--input-type=module"], {
    input: script,
    env: { ...process.env, OMK_PROJECT_ROOT: tmpDir },
    encoding: "utf-8",
    timeout: 30000,
  });
}

test("syncCommand dryRun previews changes without applying", () => {
  const result = runSyncInTemp({ dryRun: true, global: false });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SYNC_OK/);
  assert.match(result.stdout, /Dry-run summary/);
});

test("syncCommand diff option is accepted", () => {
  const result = runSyncInTemp({ dryRun: true, diff: true, global: false });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SYNC_OK/);
});

test("syncCommand rollback with empty manifest completes gracefully", () => {
  const result = runSyncInTemp({ rollback: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SYNC_OK/);
  assert.match(result.stdout, /No manifest entries found/);
});

test("syncKimiMcpGlobal preserves shell inline MCP args", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omk-sync-shell-"));
  const homeDir = mkdtempSync(join(tmpdir(), "omk-sync-home-"));
  const script = `
    import { mkdir, writeFile, readFile } from "node:fs/promises";
    import { join } from "node:path";
    import { syncKimiMcpGlobal } from "${FS_MODULE}";

    await mkdir(join(process.env.OMK_PROJECT_ROOT, ".kimi"), { recursive: true });
    await mkdir(join(process.env.OMK_PROJECT_ROOT, ".omk"), { recursive: true });
    await mkdir(join(process.env.HOME, ".kimi"), { recursive: true });
    await writeFile(join(process.env.OMK_PROJECT_ROOT, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        firecrawl: {
          command: "bash",
          args: ["-lc", "set -a; source ~/.config/omk/secrets.env 2>/dev/null; set +a; exec npx -y firecrawl-mcp"]
        }
      }
    }), "utf-8");

    await syncKimiMcpGlobal({ timestamp: "2026-05-05T00:00:00.000Z" });
    const globalRaw = await readFile(join(process.env.HOME, ".kimi", "mcp.json"), "utf-8");
    console.log(globalRaw);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module"], {
    input: script,
    env: {
      ...process.env,
      HOME: homeDir,
      OMK_ORIGINAL_HOME: homeDir,
      OMK_PROJECT_ROOT: tmpDir,
      OMK_MCP_ALLOW_WRITE_CONFIG: "1",
    },
    encoding: "utf-8",
    timeout: 30000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes("source ~/.config/omk/secrets.env"), true);
  assert.doesNotMatch(result.stdout, /omk-sync-shell-.*source/);
});

test("sync backup directory uses path-safe timestamps", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omk-sync-backup-"));
  const script = `
    import { basename } from "node:path";
    import { getBackupDir } from "${FS_MODULE}";
    const backupDir = getBackupDir("2026-05-05T00:00:00.000Z");
    console.log(basename(backupDir));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module"], {
    input: script,
    env: { ...process.env, OMK_PROJECT_ROOT: tmpDir },
    encoding: "utf-8",
    timeout: 30000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout.trim(), /:/);
  assert.match(result.stdout.trim(), /^2026-05-05T00-00-00\.000Z$/);
});
