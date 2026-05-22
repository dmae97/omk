import { appendFile, readFile } from "fs/promises";
import { join } from "path";
import { redactSecrets } from "../orchestration/state-persister.js";

export type ReplayEventType =
  | "replay-start"
  | "replay-end"
  | "node-start"
  | "node-complete"
  | "node-fallback"
  | "state-change";

export type TelemetryEventType =
  | ReplayEventType
  | "lane.started"
  | "lane.activity"
  | "lane.heartbeat"
  | "lane.completed"
  | "lane.failed"
  | "lane.stalled"
  | "agent.spawned"
  | "tool.started"
  | "tool.completed"
  | "mcp.started"
  | "mcp.completed"
  | "mcp.failed"
  | "hook.started"
  | "hook.completed"
  | "provider.route"
  | "provider.fallback"
  | "evidence.result";

export interface TelemetryEvent {
  schemaVersion: "telemetry.v1";
  type: TelemetryEventType;
  timestamp: string;
  seq: number;
  runId: string;
  nodeId?: string;
  laneId?: string;
  agentId?: string;
  toolName?: string;
  provider?: string;
  status?: string;
  data?: Record<string, unknown>;
}

export type ReplayEvent = TelemetryEvent;

export interface ReadEventsOptions {
  afterSeq?: number;
  limit?: number;
}

type EventInput = Omit<TelemetryEvent, "schemaVersion" | "timestamp" | "seq"> & {
  schemaVersion?: "telemetry.v1";
  timestamp?: string;
  seq?: number;
};

const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 4;
const seqByRunDir = new Map<string, number>();
const appendQueueByRunDir = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shouldRedactPayloadKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "env" ||
    normalized === "headers" ||
    normalized === "header" ||
    normalized === "args" ||
    normalized === "arguments" ||
    normalized === "toolargs" ||
    normalized === "rawargs" ||
    normalized === "stdout" ||
    normalized === "stderr" ||
    normalized === "rawstdout" ||
    normalized === "rawstderr";
}

function boundString(value: string): string {
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${value.length - MAX_STRING_LENGTH} chars]`
    : value;
}

function sanitizeTelemetryValue(value: unknown, depth = 0, key?: string): unknown {
  if (key && shouldRedactPayloadKey(key)) return "[redacted]";
  const redacted = redactSecrets(value);
  if (typeof redacted === "string") return boundString(redacted);
  if (typeof redacted !== "object" || redacted === null) return redacted;
  if (depth >= MAX_DEPTH) return "[truncated-depth]";
  if (Array.isArray(redacted)) {
    const out = redacted
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeTelemetryValue(item, depth + 1));
    if (redacted.length > MAX_ARRAY_ITEMS) {
      out.push(`[truncated ${redacted.length - MAX_ARRAY_ITEMS} items]`);
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(redacted);
  for (const [entryKey, entryValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
    out[entryKey] = sanitizeTelemetryValue(entryValue, depth + 1, entryKey);
  }
  if (entries.length > MAX_OBJECT_KEYS) {
    out.truncatedKeys = entries.length - MAX_OBJECT_KEYS;
  }
  return out;
}

function sanitizeTelemetryEvent(event: EventInput, seq: number): TelemetryEvent {
  const sanitized = sanitizeTelemetryValue(event);
  const record = isRecord(sanitized) ? sanitized : {};
  return {
    schemaVersion: "telemetry.v1",
    type: String(record.type ?? event.type) as TelemetryEventType,
    timestamp: typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString(),
    seq,
    runId: String(record.runId ?? event.runId),
    nodeId: typeof record.nodeId === "string" ? record.nodeId : undefined,
    laneId: typeof record.laneId === "string" ? record.laneId : undefined,
    agentId: typeof record.agentId === "string" ? record.agentId : undefined,
    toolName: typeof record.toolName === "string" ? record.toolName : undefined,
    provider: typeof record.provider === "string" ? record.provider : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    data: isRecord(record.data) ? record.data : undefined,
  };
}

async function nextSeq(runDir: string, explicitSeq?: number): Promise<number> {
  if (typeof explicitSeq === "number" && Number.isFinite(explicitSeq) && explicitSeq > 0) {
    seqByRunDir.set(runDir, explicitSeq);
    return explicitSeq;
  }
  const current = seqByRunDir.get(runDir);
  if (current != null) {
    const next = current + 1;
    seqByRunDir.set(runDir, next);
    return next;
  }
  const events = await readEvents(runDir);
  const maxSeq = events.reduce((max, event) => Math.max(max, event.seq || 0), 0);
  const next = maxSeq + 1;
  seqByRunDir.set(runDir, next);
  return next;
}

export async function appendEvent(
  runDir: string,
  event: EventInput
): Promise<void> {
  const previous = appendQueueByRunDir.get(runDir) ?? Promise.resolve();
  const write = previous.then(async () => {
    const seq = await nextSeq(runDir, event.seq);
    const line = JSON.stringify(sanitizeTelemetryEvent({ ...event, timestamp: event.timestamp ?? new Date().toISOString() }, seq)) + "\n";
    await appendFile(join(runDir, "events.jsonl"), line, "utf-8");
  });
  appendQueueByRunDir.set(runDir, write.catch(() => {}));
  await write;
}

export async function readEvents(runDir: string): Promise<ReplayEvent[]> {
  try {
    const content = await readFile(join(runDir, "events.jsonl"), "utf-8");
    const events: ReplayEvent[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as EventInput;
        const seq = typeof parsed.seq === "number" && Number.isFinite(parsed.seq) ? parsed.seq : events.length + 1;
        events.push(sanitizeTelemetryEvent(parsed, seq));
      } catch {
        // Keep append-only logs readable even if one line is corrupt.
      }
    }
    return events;
  } catch {
    return [];
  }
}

export async function tailEvents(runDir: string, options: ReadEventsOptions = {}): Promise<ReplayEvent[]> {
  const afterSeq = options.afterSeq ?? 0;
  const filtered = (await readEvents(runDir)).filter((event) => event.seq > afterSeq);
  if (options.limit != null && options.limit >= 0) {
    return filtered.slice(-options.limit);
  }
  return filtered;
}
