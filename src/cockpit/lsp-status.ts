/**
 * LSP status detector for cockpit rail view.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { pathExists } from "../util/fs.js";
import type { LspStatusEntry } from "./types.js";

export async function getLspStatus(root: string): Promise<LspStatusEntry[]> {
  const lspConfigPath = join(root, ".omk", "lsp.json");
  if (await pathExists(lspConfigPath)) {
    try {
      const raw = await readFile(lspConfigPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const config = parsed as { enabled?: unknown; servers?: Record<string, unknown> };
        if (config.servers && typeof config.servers === "object") {
          const enabled = config.enabled !== false;
          return Object.keys(config.servers).map((name) => ({
            name,
            status: enabled ? "connected" : "disabled",
          }));
        }
      }
      if (Array.isArray(parsed)) {
        return parsed
          .map((item): LspStatusEntry | null => {
            if (typeof item !== "object" || item == null) return null;
            const name = String((item as Record<string, unknown>).name ?? "unknown");
            const enabled = Boolean((item as Record<string, unknown>).enabled ?? true);
            return { name, status: enabled ? "connected" : "disabled" };
          })
          .filter((e): e is LspStatusEntry => e != null);
      }
    } catch {
      // fallthrough to fallback
    }
  }

  // Fallback: detect common LSPs by checking if their config exists
  const entries: LspStatusEntry[] = [];
  if (await pathExists(join(root, "tsconfig.json"))) {
    entries.push({ name: "typescript", status: "disabled" });
  }
  if (
    await pathExists(join(root, "pyproject.toml"))
    || await pathExists(join(root, "requirements.txt"))
    || await pathExists(join(root, "uv.lock"))
    || await pathExists(join(root, "setup.py"))
  ) {
    entries.push({ name: "python", status: "disabled" });
  }
  return entries;
}
