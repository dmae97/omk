import { mkdir, copyFile, readdir, writeFile, readFile, rename } from "fs/promises";
import { dirname, join } from "path";
import { getCopyEntryKind, skillDirectoryHasSecretContent, shouldSkipSkillCopyEntry, shellQuote, stableNodeExecutable } from "./utils.js";
import type { CopyTemplateDirOptions, SkillCopyStats, McpServerDefinition } from "./types.js";

export async function copyTemplateDir(src: string, dest: string, options: CopyTemplateDirOptions = {}): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    if (await options.skipEntry?.(srcPath, entry)) continue;
    const destPath = join(dest, entry.name);
    const kind = await getCopyEntryKind(srcPath, entry);
    if (kind === "directory") {
      await mkdir(destPath, { recursive: true });
      await copyTemplateDir(srcPath, destPath, options);
    } else if (kind === "file") {
      await mkdir(dirname(destPath), { recursive: true });
      await copyFile(srcPath, destPath);
    }
  }
}

export async function copySafeSkillRoot(src: string, dest: string): Promise<SkillCopyStats> {
  const stats: SkillCopyStats = {
    copied: 0,
    skippedUnsafe: 0,
    skippedUnavailable: 0,
  };
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    if (entry.name.startsWith(".") || shouldSkipSkillCopyEntry(srcPath, entry)) continue;

    const kind = await getCopyEntryKind(srcPath, entry);
    if (kind !== "directory") {
      if (entry.isSymbolicLink()) stats.skippedUnavailable++;
      continue;
    }

    try {
      if (await skillDirectoryHasSecretContent(srcPath)) {
        stats.skippedUnsafe++;
        continue;
      }

      await copyTemplateDir(srcPath, join(dest, entry.name), {
        skipEntry: shouldSkipSkillCopyEntry,
      });
      stats.copied++;
    } catch {
      stats.skippedUnavailable++;
    }
  }

  return stats;
}

export function createOmkProjectMcpServer(
  projectRoot: string,
  options: { packageRoot?: string; platform?: NodeJS.Platform } = {}
): McpServerDefinition {
  const isWin = (options.platform ?? process.platform) === "win32";
  const env = { OMK_PROJECT_ROOT: projectRoot };
  const node = stableNodeExecutable();

  return {
    command: isWin ? "omk" : "bash",
    args: isWin ? ["mcp", "serve", "omk-project"] : ["-lc", createUnixOmkProjectMcpScript(node)],
    env,
  };
}

function createUnixOmkProjectMcpScript(node: string): string {
  const quotedNode = shellQuote(node);
  const resolveRealpathScript = "const fs=require('fs');process.stdout.write(fs.realpathSync(process.argv[1]))";

  return [
    "set -e",
    'omk_bin="$(command -v omk 2>/dev/null || true)"',
    'if [ -n "$omk_bin" ]; then',
    `  omk_cli="$(${quotedNode} -e ${shellQuote(resolveRealpathScript)} "$omk_bin" 2>/dev/null || true)"`,
    '  if [ -n "$omk_cli" ]; then',
    `    exec ${quotedNode} "$omk_cli" mcp serve omk-project`,
    "  fi",
    "fi",
    'mcp_bin="$(command -v omk-project-mcp 2>/dev/null || true)"',
    'if [ -n "$mcp_bin" ]; then',
    `  mcp_js="$(${quotedNode} -e ${shellQuote(resolveRealpathScript)} "$mcp_bin" 2>/dev/null || true)"`,
    '  if [ -n "$mcp_js" ]; then',
    `    exec ${quotedNode} "$mcp_js"`,
    "  fi",
    "fi",
    'echo "omk-project MCP server not found; install OMK or rerun omk init" >&2',
    "exit 127",
  ].join("\n");
}

export function createMcpJson(_projectRoot: string): { mcpServers: Record<string, McpServerDefinition> } {
  return {
    mcpServers: {
      // omk-project is now auto-injected at runtime by injectKimiGlobals.
      // Project-local .omk/mcp.json only needs to hold user-added MCP servers.
    },
  };
}

export async function ensureProjectMcpConfig(
  path: string,
  fallback: Record<string, unknown>,
  options: { removeRuntimeManagedOmkProject?: boolean } = {}
): Promise<void> {
  const existing = await readFile(path, "utf-8").catch(() => null);
  if (!existing) {
    await writeFile(path, JSON.stringify(fallback, null, 2) + "\n");
    return;
  }

  try {
    const parsed = JSON.parse(existing) as { mcpServers?: Record<string, unknown> };
    if (options.removeRuntimeManagedOmkProject && parsed.mcpServers?.["omk-project"]) {
      delete parsed.mcpServers["omk-project"];
      await writeFile(path, JSON.stringify(parsed, null, 2) + "\n");
    }
  } catch {
    // Preserve malformed user-owned MCP config rather than overwriting custom entries.
  }
}

export async function checkOmkInPath(): Promise<{ inPath: boolean }> {
  try {
    const result = await import("../../util/shell.js").then((m) => m.runShell("which", ["omk"], { timeout: 3000 }));
    return { inPath: !result.failed && result.stdout.trim().length > 0 };
  } catch {
    return { inPath: false };
  }
}

export async function maybeInstallShellCompletion(_root: string): Promise<void> {
  const bashrc = join(process.env.HOME || process.env.USERPROFILE || "", ".bashrc");
  const zshrc = join(process.env.HOME || process.env.USERPROFILE || "", ".zshrc");

  const omkAliasBlock = `# >>> omk shell integration
export OMK_STAR_PROMPT=1
export OMK_RENDER_LOGO=1
# <<< end omk shell integration`;

  for (const rcFile of [bashrc, zshrc]) {
    if (!(await import("../../util/fs.js").then((m) => m.pathExists(rcFile)))) continue;
    try {
      const content = await readFile(rcFile, "utf-8");
      if (content.includes("omk shell integration")) continue;
      const tmpRc = rcFile + ".omk.tmp";
      await writeFile(tmpRc, content.trimEnd() + "\n\n" + omkAliasBlock + "\n");
      await rename(tmpRc, rcFile);
      const { status } = await import("../../util/theme.js");
      console.log(status.ok(`Shell integration added: ${rcFile}`));
    } catch {
      // ignore
    }
  }
}
