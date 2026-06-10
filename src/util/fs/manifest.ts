import { readFile, writeFile, copyFile } from "fs/promises";
import { dirname, join } from "path";
import { SyncManifestEntry } from "../sync-manifest.js";
import { ensureDir, pathExists } from "./core.js";
import { getOmkPath } from "./paths.js";

export function getManifestPath(): string {
  return getOmkPath("sync-manifest.json");
}

export function getBackupDir(timestamp: string): string {
  return getOmkPath(join("sync-backups", sanitizeBackupTimestamp(timestamp)));
}

function sanitizeBackupTimestamp(timestamp: string): string {
  const sanitized = timestamp.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return sanitized.replace(/^-|-$/g, "") || "backup";
}

export async function readManifest(): Promise<SyncManifestEntry[]> {
  const path = getManifestPath();
  if (!(await pathExists(path))) return [];
  try {
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as SyncManifestEntry[];
  } catch {
    // ignore invalid manifest
  }
  return [];
}

export async function writeManifest(entries: SyncManifestEntry[]): Promise<void> {
  const path = getManifestPath();
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(entries, null, 2) + "\n", "utf-8");
}

export async function backupFile(sourcePath: string, backupDir: string, relativePath: string): Promise<string> {
  const dest = join(backupDir, relativePath);
  await ensureDir(dirname(dest));
  await copyFile(sourcePath, dest);
  return dest;
}
