import { writeFile, readdir, readFile } from "fs/promises";
import { join } from "path";
import { getRunPath, getOmkPath, pathExists, ensureDir, validateRunId } from "./fs.js";

export function createOmkSessionId(prefix: "chat" | "plan" | "run" | "team" | "session" | "feature" | "bugfix" | "refactor" | "review" = "session"): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${timestamp}-${process.pid}`;
}

export function createOmkSessionEnv(projectRoot: string, sessionId: string): Record<string, string> {
  return {
    OMK_PROJECT_ROOT: projectRoot,
    OMK_SESSION_ID: sessionId,
  };
}

export interface SessionMeta {
  runId: string;
  type: "chat" | "plan" | "run" | "team" | "parallel";
  status: "active" | "completed" | "failed" | "idle";
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  goalTitle?: string;
  todoCount: number;
  todoDoneCount: number;
}

export async function ensureSessionDir(runId: string): Promise<string> {
  const sanitized = validateRunId(runId);
  const dir = getRunPath(sanitized);
  await ensureDir(dir);
  return dir;
}

export async function writeSessionMeta(runId: string, meta: SessionMeta): Promise<void> {
  const sanitized = validateRunId(runId);
  const dir = await ensureSessionDir(sanitized);
  const metaPath = join(dir, "session.json");
  const payload: SessionMeta = {
    ...meta,
    runId: sanitized,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(metaPath, JSON.stringify(payload, null, 2), "utf-8");
}

export async function readSessionMeta(runId: string): Promise<SessionMeta | null> {
  const sanitized = validateRunId(runId);
  const metaPath = join(getRunPath(sanitized), "session.json");
  if (!(await pathExists(metaPath))) return null;
  try {
    const content = await readFile(metaPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (!isSessionMeta(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function listActiveSessions(): Promise<SessionMeta[]> {
  const runsDir = getOmkPath("runs");
  if (!(await pathExists(runsDir))) return [];

  const entries = await readdir(runsDir, { withFileTypes: true });
  const results: SessionMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readSessionMeta(entry.name).catch(() => null);
    if (meta && meta.status === "active") {
      results.push(meta);
    }
  }

  return results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function isSessionMeta(value: unknown): value is SessionMeta {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.runId === "string" &&
    typeof v.type === "string" &&
    ["chat", "plan", "run", "team", "parallel"].includes(v.type) &&
    typeof v.status === "string" &&
    ["active", "completed", "failed", "idle"].includes(v.status) &&
    typeof v.startedAt === "string" &&
    typeof v.updatedAt === "string" &&
    typeof v.todoCount === "number" &&
    typeof v.todoDoneCount === "number" &&
    (v.endedAt === undefined || typeof v.endedAt === "string") &&
    (v.goalTitle === undefined || typeof v.goalTitle === "string")
  );
}
