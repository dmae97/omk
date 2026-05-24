import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export const OMK_REPO_URL = "https://github.com/dmae97/open_multi-agent_kit";

let cachedVersion: string | undefined;

function packageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return join(dirname(currentFile), "..", "..");
}

export function getOmkVersionSync(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const packageJson = JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf-8")) as {
      version?: unknown;
    };
    cachedVersion = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}

export function formatOmkVersionFooter(version: string = getOmkVersionSync()): string {
  return `omk v${version} • GitHub: ${OMK_REPO_URL}`;
}
