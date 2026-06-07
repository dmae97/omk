import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export const OMK_REPO_URL = "https://github.com/dmae97/open-multi-agent-kit";

let cachedVersion: string | undefined;
let cachedRepoUrl: string | undefined;

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

function normalizeRepositoryUrl(repository: unknown): string | undefined {
  const value = typeof repository === "string"
    ? repository
    : repository && typeof repository === "object" && "url" in repository && typeof repository.url === "string"
      ? repository.url
      : undefined;
  if (!value) return undefined;
  return value
    .replace(/^git\+/, "")
    .replace(/\.git$/, "");
}

export function getOmkRepoUrlSync(): string {
  if (cachedRepoUrl) return cachedRepoUrl;
  try {
    const packageJson = JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf-8")) as {
      homepage?: unknown;
      repository?: unknown;
    };
    cachedRepoUrl = normalizeRepositoryUrl(packageJson.repository)
      ?? (typeof packageJson.homepage === "string" ? packageJson.homepage.replace(/#readme$/, "") : undefined)
      ?? OMK_REPO_URL;
  } catch {
    cachedRepoUrl = OMK_REPO_URL;
  }
  return cachedRepoUrl;
}

export function formatOmkVersionFooter(version: string = getOmkVersionSync()): string {
  return `omk v${version} • GitHub: ${getOmkRepoUrlSync()}`;
}
