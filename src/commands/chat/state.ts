import { getRunPath } from "../../util/fs.js";
import { readFile, writeFile } from "fs/promises";
import { readSessionMeta, writeSessionMeta } from "../../util/session.js";

interface MutableChatNode {
  id: string;
  startedAt?: string;
  durationMs?: number;
  thinking?: string;
  status?: string;
  completedAt?: string;
}

interface MutableChatState {
  nodes?: MutableChatNode[];
  updatedAt?: string;
  status?: string;
}

function parseMutableChatState(raw: string): MutableChatState | null {
  const value = JSON.parse(raw) as unknown;
  if (value === null || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  return {
    nodes: Array.isArray(obj.nodes) ? (obj.nodes as MutableChatNode[]) : undefined,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : undefined,
    status: typeof obj.status === "string" ? obj.status : undefined,
  };
}

export async function updateChatHeartbeat(root: string, runId: string): Promise<void> {
  const statePath = getRunPath(runId, "state.json", root);
  try {
    const raw = await readFile(statePath, "utf8");
    const state = parseMutableChatState(raw);
    if (!state || !state.nodes?.length) return;
    const chatNode = state.nodes.find((n) => n.id === "chat");
    if (!chatNode) return;
    const started = Date.parse(chatNode.startedAt ?? "");
    chatNode.durationMs = Date.now() - (Number.isNaN(started) ? Date.now() : started);
    state.updatedAt = new Date().toISOString();
    await writeFile(statePath, JSON.stringify(state, null, 2));
  } catch {
    // ignore heartbeat failures
  }
}

export async function updateChatThinking(root: string, runId: string, thinking: string): Promise<void> {
  const statePath = getRunPath(runId, "state.json", root);
  try {
    const raw = await readFile(statePath, "utf8");
    const state = parseMutableChatState(raw);
    if (!state || !state.nodes?.length) return;
    const chatNode = state.nodes.find((n) => n.id === "chat");
    if (!chatNode) return;
    chatNode.thinking = thinking;
    state.updatedAt = new Date().toISOString();
    await writeFile(statePath, JSON.stringify(state, null, 2));
  } catch {
    // ignore
  }
}

export async function finalizeChatRunState(root: string, runId: string, success: boolean): Promise<void> {
  const statePath = getRunPath(runId, "state.json", root);
  try {
    const raw = await readFile(statePath, "utf8");
    const state = parseMutableChatState(raw);
    if (!state || !state.nodes?.length) return;
    const chatNode = state.nodes.find((n) => n.id === "chat");
    if (!chatNode) return;
    chatNode.status = success ? "done" : "failed";
    const completedAt = new Date();
    chatNode.completedAt = completedAt.toISOString();
    const started = Date.parse(chatNode.startedAt ?? "");
    const durationMs = completedAt.getTime() - (Number.isNaN(started) ? completedAt.getTime() : started);
    chatNode.durationMs = Math.max(1, durationMs);
    state.status = success ? "done" : "failed";
    state.updatedAt = new Date().toISOString();
    await writeFile(statePath, JSON.stringify(state, null, 2));
  } catch {
    // ignore finalize failures
  }
  // Update session.json
  try {
    const meta = await readSessionMeta(runId).catch(() => null);
    const now = new Date().toISOString();
    if (meta) {
      meta.status = success ? "completed" : "failed";
      meta.endedAt = now;
      meta.updatedAt = now;
      await writeSessionMeta(runId, meta);
    } else {
      await writeSessionMeta(runId, {
        runId,
        type: "chat",
        status: success ? "completed" : "failed",
        startedAt: now,
        updatedAt: now,
        todoCount: 0,
        todoDoneCount: 0,
      });
    }
  } catch {
    // ignore session finalize failures
  }
}
