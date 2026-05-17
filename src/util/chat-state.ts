import { readFile, writeFile } from "fs/promises";
import { getProjectRoot, getRunPath } from "./fs.js";
import type { RunState } from "../contracts/orchestration.js";

export interface ChatState extends RunState {
  /** Chat-run status not present on the base RunState contract. */
  status?: string;
  /** Creation timestamp used by chat state initialisation. */
  createdAt?: string;
}

type StateMutator = (state: ChatState) => void;

interface QueueEntry {
  ops: Array<{ op: StateMutator; resolve: () => void }>;
  running: boolean;
}

const queues = new Map<string, QueueEntry>();

async function drainQueue(runId: string, root: string): Promise<void> {
  const entry = queues.get(runId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    while (entry.ops.length > 0) {
      const { op, resolve } = entry.ops.shift()!;
      try {
        const statePath = getRunPath(runId, "state.json", root);
        const raw = await readFile(statePath, "utf8");
        const state = JSON.parse(raw) as ChatState;
        op(state);
        state.updatedAt = new Date().toISOString();
        await writeFile(statePath, JSON.stringify(state, null, 2));
      } catch (err: unknown) {
        process.stderr.write(`[omk] chat-state drain failed: ${err instanceof Error ? err.message : String(err)}\n`);
        // resilient to individual patch failures
      } finally {
        resolve();
      }
    }
  } finally {
    entry.running = false;
  }
}

function enqueue(runId: string, op: StateMutator, root: string): Promise<void> {
  return new Promise((resolve) => {
    let entry = queues.get(runId);
    if (!entry) {
      entry = { ops: [], running: false };
      queues.set(runId, entry);
    }
    entry.ops.push({ op, resolve });
    drainQueue(runId, root).catch((err: unknown) => {
      process.stderr.write(`[omk] chat-state enqueue drain failed: ${err instanceof Error ? err.message : String(err)}\n`);
    });
  });
}

/**
 * Queue a shallow patch to the chat run state.json.
 * Patches are applied serially to avoid read-modify-write races.
 */
export function queueChatStatePatch(runId: string, patch: Partial<ChatState>, root?: string): Promise<void> {
  const projectRoot = root ?? getProjectRoot();
  return enqueue(runId, (state) => {
    Object.assign(state, patch);
  }, projectRoot);
}

/**
 * Update the lastHeartbeatAt timestamp (liveness ping).
 * Does NOT update lastActivityAt — use updateChatActivity for real output.
 */
export function updateChatHeartbeat(runId: string, root?: string): Promise<void> {
  const projectRoot = root ?? getProjectRoot();
  return enqueue(runId, (state) => {
    state.lastHeartbeatAt = new Date().toISOString();
  }, projectRoot);
}

/**
 * Update lastActivityAt and optionally the chat node's thinking text.
 * Use this when there is real output (tool calls, thinking updates).
 */
export function updateChatActivity(runId: string, thinking?: string, root?: string): Promise<void> {
  const projectRoot = root ?? getProjectRoot();
  const now = new Date().toISOString();
  return enqueue(runId, (state) => {
    state.lastActivityAt = now;
    if (thinking !== undefined && state.nodes) {
      const chatNode = state.nodes.find((n) => n.id === "chat");
      if (chatNode) {
        chatNode.thinking = thinking;
      }
    }
  }, projectRoot);
}

/**
 * Mark the chat run as done or failed.
 * Computes durationMs from startedAt for backward compatibility with old state.json consumers.
 */
export function finalizeChatState(runId: string, success: boolean, _exitCode?: number, root?: string): Promise<void> {
  const projectRoot = root ?? getProjectRoot();
  const completedAt = new Date();
  const now = completedAt.toISOString();
  return enqueue(runId, (state) => {
    state.status = success ? "done" : "failed";
    if (state.nodes) {
      const chatNode = state.nodes.find((n) => n.id === "chat");
      if (chatNode) {
        chatNode.status = success ? "done" : "failed";
        chatNode.completedAt = now;
        const started = Date.parse(chatNode.startedAt ?? "");
        if (!Number.isNaN(started)) {
          chatNode.durationMs = Math.max(1, completedAt.getTime() - started);
        }
      }
    }
  }, projectRoot);
}
