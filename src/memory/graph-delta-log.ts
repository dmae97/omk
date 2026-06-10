import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, statSync, truncateSync, unlinkSync, writeSync } from "node:fs";
import { open as fsOpen, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import type { LocalGraphState, LocalGraphNode, LocalGraphEdge } from "./local-graph-memory-store.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DeltaRecord {
  v: 2;
  epoch: number;
  seq: number;
  ts: string;
  meta: { updatedAt: string; project: { key: string; name: string; root: string }; ontology: string };
  nodes: { del: string[]; put: LocalGraphNode[] };
  edges: { del: string[]; put: LocalGraphEdge[] };
  crc: string;
}

export interface DeltaManifest {
  formatVersion: 2;
  snapshot: string;
  snapshotEpoch: number;
  delta: string;
  deltaOpCount: number;
}

export type DurabilityMode = "legacy" | "delta";

// ── Path helpers ────────────────────────────────────────────────────────────

function deltaDir(graphPath: string): string {
  return dirname(graphPath);
}

function snapshotPath(graphPath: string): string {
  return join(deltaDir(graphPath), "graph.snapshot.json");
}

function deltaLogPath(graphPath: string): string {
  return join(deltaDir(graphPath), "graph.delta.jsonl");
}

function manifestPath(graphPath: string): string {
  return join(deltaDir(graphPath), "graph.manifest.json");
}

// ── Durability mode detection ───────────────────────────────────────────────

export function resolveDurabilityMode(env: NodeJS.ProcessEnv = process.env): DurabilityMode {
  const raw = (env.OMK_MEMORY_DURABILITY ?? "").trim().toLowerCase();
  if (raw === "delta") return "delta";
  return "legacy";
}

// ── Write helpers ───────────────────────────────────────────────────────────

async function writeFileAtomic(path: string, payload: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const hash = createHash("sha256").update(payload).digest("hex").slice(0, 8);
  const tempPath = `${path}.${process.pid}.${Date.now()}.${hash}.tmp`;
  try {
    await writeFile(tempPath, payload, "utf-8");
    await rename(tempPath, path);
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

// ── CRC / hashing ───────────────────────────────────────────────────────────

function computeRecordCrc(record: Omit<DeltaRecord, "crc">): string {
  // Canonical: JSON.stringify(recordWithoutCrc) + "\n", then SHA256
  const payload = `${JSON.stringify(record)}\n`;
  return createHash("sha256").update(payload).digest("hex");
}

function verifyRecordCrc(record: DeltaRecord): boolean {
  // Rebuild record without crc, re-serialize, and compare against the stored crc.
  const { crc, ...withoutCrc } = record;
  const expected = computeRecordCrc(withoutCrc as Omit<DeltaRecord, "crc">);
  return expected === crc;
}

// ── Delta computation ───────────────────────────────────────────────────────

/**
 * Compute an order-faithful delta between pre-mutation and post-mutation state.
 *
 * The legacy full-rewrite produces array orders of the form
 *   [survivors kept in pre-order (some updated in place)] ++ [appended at end]
 * because `upsertNode`/`upsertEdge` update existing entries in place but push
 * brand-new (or filter-then-re-added, e.g. `replaceGeneratedMindmap`) entries
 * to the end. A naive `Map.set` replay keeps the OLD position for an existing
 * key and therefore diverges when an entry is filtered out then re-added.
 *
 * To reproduce the EXACT raw array order on replay we:
 *   1. Keep the longest front prefix of the final array whose entries exist in
 *      pre-state with strictly increasing pre-positions (these stay in place).
 *   2. Treat every entry from the first break point onward as "repositioned":
 *      emit a `del` (so replay removes it from its old Map slot) then a `put`
 *      in final order (so replay re-inserts it at the array end).
 * Replay applies all `del` then all `put`, so del-before-put moves repositioned
 * keys to the end exactly as the legacy filter+repush does.
 */
function computeOrderedDelta<T extends { id: string }>(
  pre: ReadonlyMap<string, T>,
  finalArr: readonly T[]
): { del: string[]; put: T[] } {
  // Pre-position index (Map iteration order == insertion order == pre array order).
  const prePos = new Map<string, number>();
  let position = 0;
  for (const id of pre.keys()) prePos.set(id, position++);

  // Longest in-place prefix: exists in pre AND pre-position strictly increases.
  let lastPrePos = -1;
  let splitIdx = finalArr.length;
  for (let i = 0; i < finalArr.length; i += 1) {
    const pos = prePos.get(finalArr[i].id);
    if (pos !== undefined && pos > lastPrePos) {
      lastPrePos = pos;
    } else {
      splitIdx = i;
      break;
    }
  }

  // Final index for suffix (repositioned) detection.
  const finalIndex = new Map<string, number>();
  for (let i = 0; i < finalArr.length; i += 1) finalIndex.set(finalArr[i].id, i);

  // Deletes: pre entries dropped entirely, or kept but in the repositioned suffix.
  const del: string[] = [];
  for (const id of pre.keys()) {
    const fi = finalIndex.get(id);
    if (fi === undefined || fi >= splitIdx) del.push(id);
  }

  // Puts (final order): suffix entries always re-put (append); prefix entries
  // only when their value changed (in-place update keeps position).
  const put: T[] = [];
  for (let i = 0; i < finalArr.length; i += 1) {
    const item = finalArr[i];
    if (i >= splitIdx) {
      put.push(item);
    } else if (pre.get(item.id) !== item) {
      put.push(item);
    }
  }

  return { del, put };
}

/**
 * Compute an order-faithful delta between pre-mutation and post-mutation state.
 * `put` entries are ordered by their index in the final array and repositioned
 * entries are deleted-before-put, so Map-based replay reproduces the EXACT raw
 * array order of the legacy full-rewrite (see `computeOrderedDelta`).
 */
export function computeDelta(
  preNodes: ReadonlyMap<string, LocalGraphNode>,
  preEdges: ReadonlyMap<string, LocalGraphEdge>,
  state: LocalGraphState
): { nodes: { del: string[]; put: LocalGraphNode[] }; edges: { del: string[]; put: LocalGraphEdge[] } } {
  return {
    nodes: computeOrderedDelta(preNodes, state.nodes),
    edges: computeOrderedDelta(preEdges, state.edges),
  };
}

// ── Manifest I/O ────────────────────────────────────────────────────────────

export async function readManifest(graphPath: string): Promise<DeltaManifest | null> {
  const path = manifestPath(graphPath);
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DeltaManifest>;
    if (
      parsed.formatVersion === 2 &&
      typeof parsed.snapshot === "string" &&
      typeof parsed.snapshotEpoch === "number" &&
      typeof parsed.delta === "string"
    ) {
      return {
        formatVersion: 2,
        snapshot: parsed.snapshot,
        snapshotEpoch: parsed.snapshotEpoch,
        delta: parsed.delta,
        deltaOpCount: typeof parsed.deltaOpCount === "number" ? parsed.deltaOpCount : 0,
      };
    }
    return null;
  } catch (err) {
    if (errorCode(err) === "ENOENT") return null;
    throw err;
  }
}

export async function writeManifest(graphPath: string, manifest: DeltaManifest): Promise<void> {
  const payload = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFileAtomic(manifestPath(graphPath), payload);
}

// ── Snapshot I/O ────────────────────────────────────────────────────────────

async function writeSnapshot(graphPath: string, state: LocalGraphState): Promise<void> {
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  await writeFileAtomic(snapshotPath(graphPath), payload);
}

async function readSnapshot(graphPath: string): Promise<LocalGraphState | null> {
  const path = snapshotPath(graphPath);
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LocalGraphState>;
    if (parsed.version === 1 && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return {
        version: 1,
        ontology: parsed.ontology ?? { version: "", classes: [], relationTypes: [], description: "" },
        project: parsed.project ?? { key: "", name: "", root: "" },
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
        nodes: parsed.nodes,
        edges: parsed.edges,
      };
    }
    return null;
  } catch (err) {
    if (errorCode(err) === "ENOENT") return null;
    throw err;
  }
}

// ── Delta append ────────────────────────────────────────────────────────────

let deltaFd: import("node:fs/promises").FileHandle | null = null;
let deltaFdPath: string | null = null;

async function getDeltaFd(path: string): Promise<import("node:fs/promises").FileHandle> {
  if (deltaFd && deltaFdPath === path) return deltaFd;
  if (deltaFd) {
    await deltaFd.close().catch(() => {});
    deltaFd = null;
    deltaFdPath = null;
  }
  deltaFd = await fsOpen(path, "a"); // O_APPEND
  deltaFdPath = path;
  return deltaFd;
}

function closeDeltaFd(): void {
  if (deltaFd) {
    deltaFd.close().catch(() => {});
    deltaFd = null;
    deltaFdPath = null;
  }
}

/**
 * Close the cached append fd and await the close. Used before a physical
 * truncate so no stale O_APPEND handle survives the recovery rewrite.
 */
async function closeDeltaFdAsync(): Promise<void> {
  if (deltaFd) {
    const fd = deltaFd;
    deltaFd = null;
    deltaFdPath = null;
    await fd.close().catch(() => {});
  }
}

/**
 * Append a single delta record to the journal + fdatasync.
 * Returns the seq number assigned to the record.
 */
export async function appendDelta(
  graphPath: string,
  epoch: number,
  seq: number,
  ts: string,
  meta: DeltaRecord["meta"],
  nodesDelta: { del: string[]; put: LocalGraphNode[] },
  edgesDelta: { del: string[]; put: LocalGraphEdge[] }
): Promise<void> {
  const recordWithoutCrc: Omit<DeltaRecord, "crc"> = {
    v: 2,
    epoch,
    seq,
    ts,
    meta,
    nodes: nodesDelta,
    edges: edgesDelta,
  };
  const crc = computeRecordCrc(recordWithoutCrc);
  const record: DeltaRecord = { ...recordWithoutCrc, crc };
  const line = `${JSON.stringify(record)}\n`;

  const logPath = deltaLogPath(graphPath);
  await mkdir(dirname(logPath), { recursive: true });
  const fd = await getDeltaFd(logPath);
  await fd.write(line, null, "utf-8");
  await fd.datasync();
}

// ── Replay ──────────────────────────────────────────────────────────────────

/**
 * Load snapshot from disk plus replay all valid delta records.
 *
 * Replay correctness lemma:
 *   1. Base: nodes/edges loaded from snapshot into insertion-ordered Map.
 *   2. For each record with epoch === currentEpoch:
 *      a. Apply all `del` ids: Map.delete(key).
 *      b. Apply all `put` entries in array order: Map.set(key, entry).
 *         Map.set on existing key keeps position; on new/deleted key appends.
 *   3. Materialize: `[...map.values()]` produces the exact same array order
 *      as the full-rewrite saveState().
 *
 * Crash recovery: the last line of the delta log may be torn. If JSON.parse
 * fails AND it is the last line, we treat it as a torn tail and discard it.
 * A CRC mismatch on a non-final line is corruption → throws in strict mode.
 */
export function replayDeltas(
  baseState: LocalGraphState,
  records: DeltaRecord[],
  epoch: number
): LocalGraphState {
  const nodeMap = new Map<string, LocalGraphNode>();
  for (const node of baseState.nodes) nodeMap.set(node.id, node);
  const edgeMap = new Map<string, LocalGraphEdge>();
  for (const edge of baseState.edges) edgeMap.set(edge.id, edge);

  for (const record of records) {
    if (record.epoch !== epoch) continue;

    // Apply deletes
    for (const id of record.nodes.del) nodeMap.delete(id);
    for (const id of record.edges.del) edgeMap.delete(id);

    // Apply puts (order is preserved by the Map)
    for (const node of record.nodes.put) nodeMap.set(node.id, node);
    for (const edge of record.edges.put) edgeMap.set(edge.id, edge);

    // Update meta from the last record
    baseState.updatedAt = record.meta.updatedAt;
    baseState.project = record.meta.project;
    baseState.ontology = {
      version: record.meta.ontology,
      classes: [],
      relationTypes: [],
      description: "",
    };
  }

  return {
    ...baseState,
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
  };
}

export interface DeltaParseResult {
  records: DeltaRecord[];
  /** Byte offset (exclusive end) of the last valid, newline-terminated record. */
  validBytes: number;
  /** True when a trailing, non-newline-terminated partial record was detected. */
  torn: boolean;
}

/**
 * Byte-accurate parse of the delta log. Walks the raw bytes record-by-record
 * (records are `\n`-framed) and tracks the byte offset of the last VALID record
 * boundary so a recovering writer can truncate/append at exactly that offset.
 *
 * Framing policy:
 *   - A trailing segment WITHOUT a terminating newline is a torn tail (a crash
 *     mid-append): it is reported via `torn=true` and excluded from `validBytes`
 *     so the caller can physically truncate it away before any new append.
 *   - A newline-terminated line that fails JSON.parse or CRC is MID-FILE
 *     corruption: strict mode throws; non-strict mode stops replay at the first
 *     corruption (leaving `validBytes` at the last good boundary). Either way the
 *     bytes are never silently interleaved with a resumed write.
 */
async function parseDeltaLog(graphPath: string, strict: boolean): Promise<DeltaParseResult> {
  const path = deltaLogPath(graphPath);
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch (err) {
    if (errorCode(err) === "ENOENT") return { records: [], validBytes: 0, torn: false };
    throw err;
  }

  const records: DeltaRecord[] = [];
  const len = buf.length;
  const NEWLINE = 0x0a;
  let cursor = 0;
  let validBytes = 0;
  let torn = false;

  while (cursor < len) {
    const nl = buf.indexOf(NEWLINE, cursor);
    if (nl === -1) {
      // No terminating newline: trailing partial (torn) record from a crash.
      torn = true;
      break;
    }
    const recordEnd = nl + 1; // inclusive of the framing newline
    const line = buf.toString("utf-8", cursor, nl);

    if (line === "") {
      // Blank line: tolerated framing artifact; advance the valid boundary.
      validBytes = recordEnd;
      cursor = recordEnd;
      continue;
    }

    let record: DeltaRecord;
    try {
      record = JSON.parse(line) as DeltaRecord;
    } catch {
      // Newline-terminated but unparseable => mid-file corruption.
      if (strict) {
        throw new Error(`Delta log corruption: unparseable record at byte ${cursor}: ${line.slice(0, 80)}...`);
      }
      break; // non-strict: stop replay at first corruption (no interleave)
    }

    if (!verifyRecordCrc(record)) {
      if (strict) {
        throw new Error(`Delta log corruption: CRC mismatch at byte ${cursor} (seq=${record.seq})`);
      }
      break; // non-strict: stop replay at first corruption (no interleave)
    }

    records.push(record);
    validBytes = recordEnd;
    cursor = recordEnd;
  }

  return { records, validBytes, torn };
}

// ── Cold load (delta mode) ──────────────────────────────────────────────────

export interface DeltaLoadResult {
  state: LocalGraphState;
  epoch: number;
  lastSeq: number;
  deltaOpCount: number;
  /** Byte offset of the last valid record == where the next append lands. */
  validBytes: number;
}

/**
 * Full cold load in delta mode: manifest → snapshot → replay delta tail.
 *
 * Torn-tail recovery: if the log ends in a partial (non-newline-terminated)
 * record, physically truncate the file to the last valid record boundary BEFORE
 * returning, so the next O_APPEND write can never merge into the half-written
 * line. Any cached append fd is closed first to drop the stale handle.
 */
export async function loadStateViaDelta(
  graphPath: string,
  strict: boolean,
  emptyState: LocalGraphState
): Promise<DeltaLoadResult> {
  const manifest = await readManifest(graphPath);
  if (!manifest) {
    // No manifest: try legacy migration path
    return { state: emptyState, epoch: 1, lastSeq: 0, deltaOpCount: 0, validBytes: 0 };
  }

  let baseState: LocalGraphState;
  try {
    const snap = await readSnapshot(graphPath);
    baseState = snap ?? emptyState;
  } catch {
    baseState = emptyState;
  }

  const { records, validBytes, torn } = await parseDeltaLog(graphPath, strict);

  if (torn) {
    // Drop the torn trailing bytes at the last valid record boundary so a
    // resumed append starts on a clean record frame (no mid-file interleave).
    await closeDeltaFdAsync();
    try {
      truncateSync(deltaLogPath(graphPath), validBytes);
    } catch (err) {
      if (errorCode(err) !== "ENOENT") throw err;
    }
  }

  const filtered = records.filter((r) => r.epoch === manifest.snapshotEpoch);
  const state = replayDeltas(baseState, filtered, manifest.snapshotEpoch);

  return {
    state,
    epoch: manifest.snapshotEpoch,
    lastSeq: filtered.length > 0 ? filtered[filtered.length - 1].seq : 0,
    deltaOpCount: filtered.length,
    validBytes,
  };
}

// ── Setup / migration ───────────────────────────────────────────────────────

/**
 * One-time setup: load legacy graph-state.json (or empty), write snapshot,
 * write manifest, create empty delta log. Does NOT delete the legacy file.
 * If manifest already exists, this is a no-op.
 */
export async function setupDeltaMode(
  graphPath: string,
  legacyState: LocalGraphState
): Promise<DeltaManifest> {
  const existing = await readManifest(graphPath);
  if (existing) return existing;

  const manifest: DeltaManifest = {
    formatVersion: 2,
    snapshot: "graph.snapshot.json",
    snapshotEpoch: 1,
    delta: "graph.delta.jsonl",
    deltaOpCount: 0,
  };

  await writeSnapshot(graphPath, legacyState);
  await writeFile(deltaLogPath(graphPath), "", "utf-8").catch(async (err) => {
    if (errorCode(err) === "ENOENT") {
      await mkdir(dirname(deltaLogPath(graphPath)), { recursive: true });
      await writeFile(deltaLogPath(graphPath), "", "utf-8");
      return;
    }
    throw err;
  });
  await writeManifest(graphPath, manifest);

  return manifest;
}

// ── Compaction ──────────────────────────────────────────────────────────────

export interface CompactionThresholds {
  maxBytes: number;
  maxOps: number;
}

export function resolveCompactionThresholds(env: NodeJS.ProcessEnv = process.env): CompactionThresholds {
  const maxBytes = Number.parseInt(env.OMK_MEMORY_COMPACT_BYTES ?? "", 10) || 8 * 1024 * 1024; // 8MB
  const maxOps = Number.parseInt(env.OMK_MEMORY_COMPACT_OPS ?? "", 10) || 1000;
  return { maxBytes, maxOps };
}

/**
 * Check if compaction is needed and perform it if so.
 * Procedure: write snapshot → write new manifest (commit pivot) → truncate delta.
 * The manifest is the single commit point; crash before manifest pivot is safe.
 */
export async function compactIfNeeded(
  graphPath: string,
  state: LocalGraphState,
  currentEpoch: number,
  currentOpCount: number,
  thresholds: CompactionThresholds
): Promise<{ compacted: boolean; newEpoch: number; newOpCount: number }> {
  const logPath = deltaLogPath(graphPath);
  let deltaBytes = 0;
  try {
    deltaBytes = statSync(logPath).size;
  } catch {
    // File doesn't exist or can't be stat'd
  }

  const shouldCompact = deltaBytes > thresholds.maxBytes || currentOpCount > thresholds.maxOps;
  if (!shouldCompact) {
    return { compacted: false, newEpoch: currentEpoch, newOpCount: currentOpCount };
  }

  const newEpoch = currentEpoch + 1;

  // 1. Write new snapshot (covers all state up to now)
  await writeSnapshot(graphPath, state);

  // 2. Write new manifest (commit pivot)
  // Close the old delta fd so we can truncate
  closeDeltaFd();

  const manifest: DeltaManifest = {
    formatVersion: 2,
    snapshot: "graph.snapshot.json",
    snapshotEpoch: newEpoch,
    delta: "graph.delta.jsonl",
    deltaOpCount: 0,
  };
  await writeManifest(graphPath, manifest);

  // 3. Truncate delta log (records with old epoch are now folded into snapshot)
  try {
    await writeFile(logPath, "", "utf-8");
  } catch {
    // If truncate fails, re-create
    await unlink(logPath).catch(() => {});
    await writeFile(logPath, "", "utf-8");
  }

  return { compacted: true, newEpoch, newOpCount: 0 };
}

// ── Stat helpers for cache invalidation ─────────────────────────────────────

export interface DeltaFileStats {
  snapshotMtimeMs: number;
  snapshotSize: number;
  snapshotCtimeMs: number;
  snapshotIno: number;
  deltaSize: number;
}

export function statDeltaFiles(graphPath: string): DeltaFileStats | null {
  try {
    const snapStat = statSync(snapshotPath(graphPath));
    let deltaSize = 0;
    try {
      deltaSize = statSync(deltaLogPath(graphPath)).size;
    } catch {
      // delta file may not exist yet
    }
    return {
      snapshotMtimeMs: snapStat.mtimeMs,
      snapshotSize: snapStat.size,
      snapshotCtimeMs: snapStat.ctimeMs,
      snapshotIno: snapStat.ino,
      deltaSize,
    };
  } catch {
    return null;
  }
}

export function deltaStatsMatch(a: DeltaFileStats | null, b: DeltaFileStats | null): boolean {
  if (!a || !b) return false;
  return (
    a.snapshotMtimeMs === b.snapshotMtimeMs &&
    a.snapshotSize === b.snapshotSize &&
    a.snapshotCtimeMs === b.snapshotCtimeMs &&
    a.snapshotIno === b.snapshotIno &&
    a.deltaSize === b.deltaSize
  );
}

// ── Cross-process advisory lock (delta mode only) ───────────────────────────

interface LockHolder {
  pid: number;
  hostname: string;
  startedAt: string;
}

const LOCK_TTL_MS = 30000;
const LOCK_MAX_WAIT_MS = 30000;
const LOCK_BASE_BACKOFF_MS = 50;
const LOCK_MAX_BACKOFF_MS = 1000;

function deltaLockPath(graphPath: string): string {
  return `${graphPath}.delta.lock`;
}

function isLockHolderDead(holder: LockHolder): boolean {
  const started = Date.parse(holder.startedAt);
  if (Number.isNaN(started)) return true;
  if (Date.now() - started > LOCK_TTL_MS) return true;
  if (holder.hostname === hostname()) {
    try {
      process.kill(holder.pid, 0);
      return false;
    } catch (err) {
      const code = errorCode(err);
      if (code === "ESRCH") return true;
      // EPERM or other errors mean the process exists but we cannot signal it;
      // treat as alive to stay safe.
      return false;
    }
  }
  return false;
}

export async function acquireDeltaLock(graphPath: string, maxWaitMs = LOCK_MAX_WAIT_MS): Promise<void> {
  const path = deltaLockPath(graphPath);
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + maxWaitMs;

  while (true) {
    try {
      const record: LockHolder = {
        pid: process.pid,
        hostname: hostname(),
        startedAt: new Date().toISOString(),
      };
      const fd = openSync(path, "wx");
      try {
        writeSync(fd, JSON.stringify(record));
      } finally {
        closeSync(fd);
      }
      return;
    } catch (err) {
      const code = errorCode(err);
      if (code !== "EEXIST") throw err;

      let holder: LockHolder | null = null;
      try {
        const raw = readFileSync(path, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "pid" in parsed &&
          "hostname" in parsed &&
          "startedAt" in parsed
        ) {
          holder = parsed as LockHolder;
        }
      } catch {
        // unreadable / unparseable → treat as stale below
      }

      if (holder && isLockHolderDead(holder)) {
        try {
          unlinkSync(path);
        } catch (unlinkErr) {
          if (errorCode(unlinkErr) !== "ENOENT") throw unlinkErr;
        }
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `Delta lock acquisition timed out after ${maxWaitMs}ms on ${path}` +
            (holder ? ` (held by pid=${holder.pid} host=${holder.hostname} since=${holder.startedAt})` : "")
        );
      }

      const backoff = Math.min(LOCK_MAX_BACKOFF_MS, LOCK_BASE_BACKOFF_MS * (1 + Math.random()));
      await new Promise<void>((resolve) => setTimeout(resolve, backoff));
    }
  }
}

export function releaseDeltaLock(graphPath: string): void {
  const path = deltaLockPath(graphPath);
  let holder: LockHolder | null = null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "pid" in parsed &&
      "hostname" in parsed &&
      "startedAt" in parsed
    ) {
      holder = parsed as LockHolder;
    }
  } catch {
    return;
  }

  if (holder && (holder.pid !== process.pid || holder.hostname !== hostname())) {
    return;
  }

  try {
    unlinkSync(path);
  } catch (err) {
    if (errorCode(err) !== "ENOENT") throw err;
  }
}

export async function withDeltaLock<T>(
  graphPath: string,
  fn: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
  maxWaitMs = LOCK_MAX_WAIT_MS
): Promise<T> {
  if (resolveDurabilityMode(env) === "legacy") {
    return fn();
  }
  await acquireDeltaLock(graphPath, maxWaitMs);
  try {
    return await fn();
  } finally {
    releaseDeltaLock(graphPath);
  }
}
