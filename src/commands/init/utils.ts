import { readFile } from "fs/promises";
import { basename, join } from "path";
import {
  GENERIC_SKILL_SECRET_ALLOWLIST,
  GENERIC_SKILL_SECRET_ASSIGNMENT,
  packageRoot,
  PROTECTED_SKILL_FILE_PATTERNS,
  SKILL_SECRET_LITERAL_PATTERNS,
} from "./constants.js";

export function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

export async function readTemplateFile(relativePath: string, fallback: string): Promise<string> {
  try {
    return await readFile(join(packageRoot, "templates", relativePath), "utf8");
  } catch {
    return fallback;
  }
}

export async function getCopyEntryKind(
  srcPath: string,
  entry: import("node:fs").Dirent
): Promise<"directory" | "file" | null> {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  if (!entry.isSymbolicLink()) return null;

  try {
    const { stat } = await import("fs/promises");
    const targetStats = await stat(srcPath);
    if (targetStats.isDirectory()) return "directory";
    if (targetStats.isFile()) return "file";
    return null;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

import { SKILL_COPY_IGNORED_NAMES } from "./constants.js";

export function shouldSkipSkillCopyEntry(_srcPath: string, entry: import("node:fs").Dirent): boolean {
  return SKILL_COPY_IGNORED_NAMES.has(entry.name);
}

export function isProtectedSkillFileName(filePath: string): boolean {
  const name = basename(filePath);
  return PROTECTED_SKILL_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

export function isLikelyBinaryContent(buffer: Buffer): boolean {
  return buffer.includes(0);
}

export function hasSecretLikeSkillLine(line: string): boolean {
  if (SKILL_SECRET_LITERAL_PATTERNS.some((pattern) => pattern.test(line))) return true;
  return GENERIC_SKILL_SECRET_ASSIGNMENT.test(line) && !GENERIC_SKILL_SECRET_ALLOWLIST.test(line);
}

export async function skillDirectoryHasSecretContent(dir: string): Promise<boolean> {
  const { readdir } = await import("fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(dir, entry.name);
    if (shouldSkipSkillCopyEntry(srcPath, entry)) continue;
    if (isProtectedSkillFileName(srcPath)) return true;

    const kind = await getCopyEntryKind(srcPath, entry);
    if (kind === "directory") {
      if (await skillDirectoryHasSecretContent(srcPath)) return true;
      continue;
    }
    if (kind !== "file") continue;

    const buffer = await readFile(srcPath);
    if (isLikelyBinaryContent(buffer)) continue;

    const text = buffer.toString("utf-8");
    for (const line of text.split(/\r?\n/)) {
      if (hasSecretLikeSkillLine(line)) return true;
    }
  }

  return false;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

import { realpathSync } from "node:fs";

export function stableNodeExecutable(): string {
  try {
    return realpathSync(process.execPath);
  } catch {
    return process.execPath || "node";
  }
}

export function redactSecretishText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]");
}

export function isDisabledEnvValue(value: string | undefined): boolean {
  return ["0", "false", "off", "no", "never"].includes(value?.trim().toLowerCase() ?? "");
}

export function isEnabledEnvValue(value: string | undefined): boolean {
  return ["1", "true", "on", "yes", "always"].includes(value?.trim().toLowerCase() ?? "");
}
