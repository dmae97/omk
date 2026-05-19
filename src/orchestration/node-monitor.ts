import type { NodeMonitor } from "../contracts/orchestration.js";

export interface MonitorOptions {
  heartbeatIntervalMs?: number;
  stallThresholdMultiplier?: number;
  onStall?: (monitor: NodeMonitor) => void;
  onKill?: (monitor: NodeMonitor) => void;
  onRecover?: (monitor: NodeMonitor) => void;
}

export interface NodeMonitorEngine {
  register(nodeId: string, runId: string): void;
  heartbeat(nodeId: string, runId: string): void;
  unregister(nodeId: string, runId: string): void;
  getStatus(nodeId: string, runId: string): NodeMonitor | undefined;
  checkAll(): NodeMonitor[];
  dispose(): void;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_STALL_MULTIPLIER = 3;

export function createNodeMonitorEngine(options: MonitorOptions = {}): NodeMonitorEngine {
  const monitors = new Map<string, NodeMonitor>();
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const stallThresholdMultiplier = options.stallThresholdMultiplier ?? DEFAULT_STALL_MULTIPLIER;
  let checkTimer: ReturnType<typeof setInterval> | null = null;

  function key(nodeId: string, runId: string): string {
    return `${runId}::${nodeId}`;
  }

  function startChecker(): void {
    if (checkTimer) return;
    checkTimer = setInterval(() => {
      const stalled = checkAllInternal();
      for (const monitor of stalled) {
        options.onStall?.(monitor);
      }
    }, heartbeatIntervalMs);
  }

  function stopChecker(): void {
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
  }

  function checkAllInternal(): NodeMonitor[] {
    const now = Date.now();
    const stalled: NodeMonitor[] = [];
    for (const monitor of monitors.values()) {
      if (monitor.status === "stalled") continue;
      const lastHeartbeat = Date.parse(monitor.lastHeartbeatAt);
      const threshold = monitor.stallThresholdMs;
      if (now - lastHeartbeat > threshold) {
        monitor.status = "stalled";
        stalled.push(monitor);
        options.onKill?.(monitor);
      }
    }
    return stalled;
  }

  return {
    register(nodeId: string, runId: string): void {
      const k = key(nodeId, runId);
      const now = new Date().toISOString();
      monitors.set(k, {
        nodeId,
        runId,
        lastHeartbeatAt: now,
        stallThresholdMs: heartbeatIntervalMs * stallThresholdMultiplier,
        status: "healthy",
      });
      startChecker();
    },

    heartbeat(nodeId: string, runId: string): void {
      const k = key(nodeId, runId);
      const monitor = monitors.get(k);
      if (!monitor) return;
      const now = new Date().toISOString();
      monitor.lastHeartbeatAt = now;
      if (monitor.status === "stalled") {
        monitor.status = "recovered";
        options.onRecover?.(monitor);
      } else {
        monitor.status = "healthy";
      }
    },

    unregister(nodeId: string, runId: string): void {
      const k = key(nodeId, runId);
      monitors.delete(k);
      if (monitors.size === 0) {
        stopChecker();
      }
    },

    getStatus(nodeId: string, runId: string): NodeMonitor | undefined {
      return monitors.get(key(nodeId, runId));
    },

    checkAll(): NodeMonitor[] {
      return checkAllInternal();
    },

    dispose(): void {
      stopChecker();
      monitors.clear();
    },
  };
}

export function forciblyRemoveMonitor(engine: NodeMonitorEngine, nodeId: string, runId: string): void {
  engine.unregister(nodeId, runId);
}
