import {
  getProjectRoot,
  pathExists,
  syncAllKimiGlobals,
  readManifest,
  writeManifest,
  getOmkPath,
  getUserHome,
} from "../util/fs.js";
import { mkdir, writeFile, copyFile, rm } from "fs/promises";
import { dirname, join, relative, sep } from "path";
import { header, status } from "../util/theme.js";
import { t } from "../util/i18n.js";

import { sha256, type SyncManifestEntry } from "../util/sync-manifest.js";

export async function syncCommand(options?: { dryRun?: boolean; diff?: boolean; rollback?: boolean; global?: boolean }): Promise<void> {
  if (options?.rollback) {
    await rollbackSync();
    return;
  }

  const root = getProjectRoot();
  console.log(header("OMK sync"));

  const timestamp = new Date().toISOString();
  const manifest: SyncManifestEntry[] = [];

  // Create empty .kimi/mcp.json template if missing (space for user-added Kimi-specific MCPs)
  const kimiMcpPath = join(root, ".kimi", "mcp.json");
  if (!(await pathExists(kimiMcpPath))) {
    const content = JSON.stringify({ _comment: "SearchWeb and FetchURL are built-in Kimi tools.", mcpServers: {} }, null, 2) + "\n";
    if (options?.dryRun) {
      console.log(`local | create | ${relative(root, kimiMcpPath)}`);
      manifest.push({
        path: kimiMcpPath,
        scope: "local",
        action: "create",
        previousHash: null,
        newHash: sha256(content),
        backupPath: null,
        timestamp,
      });
    } else {
      await writeFile(kimiMcpPath, content, "utf-8");
      manifest.push({
        path: kimiMcpPath,
        scope: "local",
        action: "create",
        previousHash: null,
        newHash: sha256(content),
        backupPath: null,
        timestamp,
      });
      console.log(status.ok(t("sync.mcpCreated")));
    }
  }

  // Always sync hooks + MCP + skills + local graph memory policy globally to ~/.kimi/
  // + create local directories in parallel
  const agentsSkills = join(root, ".agents/skills");
  const kimiSkills = join(root, ".kimi/skills");
  const globalOpts = { dryRun: options?.dryRun, diff: options?.diff, manifest, timestamp };

  if (!options?.dryRun) {
    const tasks: Promise<unknown>[] = [
      mkdir(agentsSkills, { recursive: true }),
      mkdir(kimiSkills, { recursive: true }),
    ];
    if (options?.global) {
      tasks.push(syncAllKimiGlobals(globalOpts));
    }
    await Promise.all(tasks);
  } else {
    if (options?.global) {
      await syncAllKimiGlobals(globalOpts);
    }
    console.log(`local | create | ${relative(root, agentsSkills)} (if missing)`);
    console.log(`local | create | ${relative(root, kimiSkills)} (if missing)`);
  }

  if (options?.dryRun) {
    console.log("\n" + header("Dry-run summary"));
    for (const entry of manifest) {
      console.log(`${entry.scope} | ${entry.action} | ${entry.path}`);
    }
  } else {
    await writeManifest(manifest);
    console.log(status.ok(t("sync.globalComplete")));
    console.log("");
    console.log(status.ok(t("sync.mcpOk")));
    console.log(status.ok(t("sync.skillsOk")));
    console.log(status.ok(t("sync.agentSkillsOk")));
    console.log("\n" + status.success(t("sync.complete")));
  }
}

async function rollbackSync(): Promise<void> {
  console.log(header("OMK sync rollback"));
  const manifest = await readManifest();
  if (manifest.length === 0) {
    console.log("No manifest entries found.");
    return;
  }

  // Process in reverse order to restore the oldest state
  const reversed = [...manifest].reverse();
  for (const entry of reversed) {
    if (entry.action === "create" || entry.action === "symlink") {
      if (!isAllowedRollbackPath(entry.path)) {
        console.warn(`⚠️  Skipping ${entry.path}: not in allowed OMK paths`);
        continue;
      }
      if (await pathExists(entry.path)) {
        await rm(entry.path, { recursive: false, force: true });
        console.log(`Removed ${entry.path}`);
      }
      continue;
    }
    if (!entry.backupPath) {
      console.warn(`⚠️  Skipping ${entry.path}: no backup available`);
      continue;
    }
    if (!isAllowedRollbackPath(entry.path)) {
      console.warn(`⚠️  Skipping ${entry.path}: not in allowed OMK paths`);
      continue;
    }
    if (!(await pathExists(entry.backupPath))) {
      console.warn(`⚠️  Skipping ${entry.path}: backup not found at ${entry.backupPath}`);
      continue;
    }
    await mkdir(dirname(entry.path), { recursive: true });
    await copyFile(entry.backupPath, entry.path);
    console.log(`Restored ${entry.path}`);
  }
  console.log(status.success("Rollback complete"));

function isAllowedRollbackPath(p: string): boolean {
  const allowed = [join(getUserHome(), ".kimi"), getOmkPath()];
  return allowed.some((a) => {
    const prefix = a.endsWith(sep) ? a : a + sep;
    return p.startsWith(prefix) || p === a;
  });
}
}
