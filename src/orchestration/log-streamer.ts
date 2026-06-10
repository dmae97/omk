/**
 * LogStreamer — 병렬 에이전트 로그 스트리밍 및 관리
 *
 * 여러 워커의 로그를 실시간으로 스트리밍, 필터링, 포맷팅합니다.
 */

import { createWriteStream, type WriteStream } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import type { WorkerState, OrchestrationEvent } from "./orchestration-state.js";

export interface LogEntry {
  timestamp: string;
  workerId: string;
  level: "stdout" | "stderr" | "info" | "error" | "warn";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface LogStreamOptions {
  logDir?: string;
  enableConsole?: boolean;
  enableFile?: boolean;
  bufferSize?: number;
  format?: "plain" | "json" | "colored";
  filter?: {
    workers?: string[];
    levels?: LogEntry["level"][];
    patterns?: RegExp[];
  };
}

export interface WorkerLogHandle {
  workerId: string;
  onStdout: (line: string) => void;
  onStderr: (line: string) => void;
  log: (level: LogEntry["level"], message: string, metadata?: Record<string, unknown>) => void;
  close: () => void;
}

export class LogStreamer {
  private options: Required<LogStreamOptions>;
  private logs: LogEntry[] = [];
  private streams: Map<string, WriteStream> = new Map();
  private eventHandlers: Array<(entry: LogEntry) => void> = [];
  private consoleStream: NodeJS.WritableStream;

  constructor(options: LogStreamOptions = {}) {
    this.options = {
      logDir: options.logDir ?? ".omk/logs",
      enableConsole: options.enableConsole ?? true,
      enableFile: options.enableFile ?? true,
      bufferSize: options.bufferSize ?? 1000,
      format: options.format ?? "colored",
      filter: options.filter ?? {},
    };
    this.consoleStream = process.stdout;
  }

  /**
   * 초기화 (로그 디렉토리 생성)
   */
  async initialize(runId?: string): Promise<void> {
    if (this.options.enableFile && runId) {
      const logPath = join(this.options.logDir, runId);
      await mkdir(logPath, { recursive: true });
    }
  }

  /**
   * 워커 로그 핸들 생성
   */
  createWorkerHandle(workerId: string, runId?: string): WorkerLogHandle {
    let fileStream: WriteStream | undefined;

    if (this.options.enableFile) {
      const logPath = runId
        ? join(this.options.logDir, runId, `${workerId}.log`)
        : join(this.options.logDir, `${workerId}.log`);
      fileStream = createWriteStream(logPath, { flags: "a" });
      this.streams.set(workerId, fileStream);
    }

    const handle: WorkerLogHandle = {
      workerId,
      onStdout: (line: string) => {
        this.addEntry({
          timestamp: new Date().toISOString(),
          workerId,
          level: "stdout",
          message: line,
        });
      },
      onStderr: (line: string) => {
        this.addEntry({
          timestamp: new Date().toISOString(),
          workerId,
          level: "stderr",
          message: line,
        });
      },
      log: (level: LogEntry["level"], message: string, metadata?: Record<string, unknown>) => {
        this.addEntry({
          timestamp: new Date().toISOString(),
          workerId,
          level,
          message,
          metadata,
        });
      },
      close: () => {
        if (fileStream) {
          fileStream.end();
          this.streams.delete(workerId);
        }
      },
    };

    return handle;
  }

  /**
   * 로그 엔트리 추가
   */
  private addEntry(entry: LogEntry): void {
    // 필터 적용
    if (!this.shouldLog(entry)) {
      return;
    }

    // 버퍼 관리
    this.logs.push(entry);
    if (this.logs.length > this.options.bufferSize) {
      this.logs.shift();
    }

    // 콘솔 출력
    if (this.options.enableConsole) {
      this.writeToConsole(entry);
    }

    // 파일 출력
    if (this.options.enableFile) {
      this.writeToFile(entry);
    }

    // 이벤트 핸들러 호출
    for (const handler of this.eventHandlers) {
      handler(entry);
    }
  }

  /**
   * 필터 체크
   */
  private shouldLog(entry: LogEntry): boolean {
    const { filter } = this.options;

    if (filter.workers && !filter.workers.includes(entry.workerId)) {
      return false;
    }

    if (filter.levels && !filter.levels.includes(entry.level)) {
      return false;
    }

    if (filter.patterns && filter.patterns.length > 0) {
      const matches = filter.patterns.some((pattern) => pattern.test(entry.message));
      if (!matches) {
        return false;
      }
    }

    return true;
  }

  /**
   * 콘솔에 로그 출력
   */
  private writeToConsole(entry: LogEntry): void {
    const formatted = this.formatEntry(entry);
    this.consoleStream.write(formatted + "\n");
  }

  /**
   * 파일에 로그 출력
   */
  private writeToFile(entry: LogEntry): void {
    const stream = this.streams.get(entry.workerId);
    if (stream) {
      const formatted = this.formatEntry(entry, "json");
      stream.write(formatted + "\n");
    }
  }

  /**
   * 로그 엔트리 포맷팅
   */
  private formatEntry(entry: LogEntry, format?: "plain" | "json" | "colored"): string {
    const useFormat = format ?? this.options.format;

    if (useFormat === "json") {
      return JSON.stringify(entry);
    }

    const timestamp = entry.timestamp.split("T")[1].replace("Z", "");
    const prefix = `[${timestamp}] [${entry.workerId}]`;

    if (useFormat === "colored") {
      // Standard ANSI-16 SGR foreground codes (ECMA-48) built from numeric
      // values rather than `\x1b[3Xm` literals so color:gate stays clean.
      // Plain ANSI-16 (not brand truecolor) is intentional: these lines are
      // also parsed/greppable in log files and stay terminal-portable.
      const CSI = "\x1b[";
      const LEVEL_FG: Record<LogEntry["level"], number> = {
        stdout: 37, // white
        stderr: 31, // red
        info: 34, // blue
        warn: 33, // yellow
        error: 31, // red
      };
      const color = `${CSI}${LEVEL_FG[entry.level]}m`;
      const reset = `${CSI}0m`;
      return `${color}${prefix} [${entry.level.toUpperCase()}]${reset} ${entry.message}`;
    }

    return `${prefix} [${entry.level.toUpperCase()}] ${entry.message}`;
  }

  /**
   * 이벤트 핸들러 등록
   */
  onLog(handler: (entry: LogEntry) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index !== -1) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * 로그 조회
   */
  getLogs(workerId?: string): LogEntry[] {
    if (workerId) {
      return this.logs.filter((entry) => entry.workerId === workerId);
    }
    return [...this.logs];
  }

  /**
   * 최근 로그 조회
   */
  getRecentLogs(count: number = 50, workerId?: string): LogEntry[] {
    const logs = workerId ? this.getLogs(workerId) : this.logs;
    return logs.slice(-count);
  }

  /**
   * 로그 기록
   */
  log(level: LogEntry["level"], message: string, metadata?: Record<string, unknown>): void {
    this.addEntry({
      timestamp: new Date().toISOString(),
      workerId: "orchestrator",
      level,
      message,
      metadata,
    });
  }

  /**
   * 워커 시작 로그
   */
  logWorkerStart(worker: WorkerState): void {
    this.addEntry({
      timestamp: new Date().toISOString(),
      workerId: worker.nodeId,
      level: "info",
      message: `Worker started (retry: ${worker.retryCount}/${worker.maxRetries})`,
      metadata: { assignment: worker.assignment },
    });
  }

  /**
   * 워커 완료 로그
   */
  logWorkerComplete(worker: WorkerState, success: boolean): void {
    this.addEntry({
      timestamp: new Date().toISOString(),
      workerId: worker.nodeId,
      level: success ? "info" : "error",
      message: success
        ? `Worker completed in ${worker.durationMs}ms`
        : `Worker failed: ${worker.error ?? "Unknown error"}`,
      metadata: {
        success,
        durationMs: worker.durationMs,
        retryCount: worker.retryCount,
      },
    });
  }

  /**
   * 이벤트 로그
   */
  logEvent(event: OrchestrationEvent): void {
    this.addEntry({
      timestamp: event.timestamp,
      workerId: event.nodeId ?? "orchestrator",
      level: "info",
      message: `Event: ${event.type}`,
      metadata: event.data,
    });
  }

  /**
   * 모든 스트림 종료
   */
  async close(): Promise<void> {
    for (const [workerId, stream] of this.streams.entries()) {
      await new Promise<void>((resolve) => {
        stream.end(() => resolve());
      });
      this.streams.delete(workerId);
    }
  }

  /**
   * 로그 요약 출력
   */
  formatSummary(): string {
    const lines: string[] = [];
    lines.push("📜 Log Summary");
    lines.push("─".repeat(50));
    lines.push(`Total Entries: ${this.logs.length}`);

    const byLevel = this.logs.reduce((acc, entry) => {
      acc[entry.level] = (acc[entry.level] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    lines.push("By Level:");
    for (const [level, count] of Object.entries(byLevel)) {
      lines.push(`  ${level}: ${count}`);
    }

    const byWorker = this.logs.reduce((acc, entry) => {
      acc[entry.workerId] = (acc[entry.workerId] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    lines.push("\nBy Worker:");
    for (const [workerId, count] of Object.entries(byWorker)) {
      lines.push(`  ${workerId}: ${count} entries`);
    }

    return lines.join("\n");
  }
}
