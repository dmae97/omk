/**
 * Centralized file logger for omp.
 *
 * Logs to ~/.omp/logs/ with size-based rotation, supporting concurrent omp instances.
 * Each log entry includes process.pid for traceability.
 */
import * as fs from "node:fs";
import { RingBuffer } from "@oh-my-pi/pi-utils/ring";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { getLogsDir } from "./dirs";

/** Ensure logs directory exists */
function ensureLogsDir(): string {
	const logsDir = getLogsDir();
	if (!fs.existsSync(logsDir)) {
		fs.mkdirSync(logsDir, { recursive: true });
	}
	return logsDir;
}

/** Custom format that includes pid and flattens metadata */
const logFormat = winston.format.combine(
	winston.format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
	winston.format.printf(({ timestamp, level, message, ...meta }) => {
		const entry: Record<string, unknown> = {
			timestamp,
			level,
			pid: process.pid,
			message,
		};
		// Flatten metadata into entry
		for (const [key, value] of Object.entries(meta)) {
			if (key !== "level" && key !== "timestamp" && key !== "message") {
				entry[key] = value;
			}
		}
		return JSON.stringify(entry);
	}),
);

/** Size-based rotating file transport */
const fileTransport = new DailyRotateFile({
	dirname: ensureLogsDir(),
	filename: "omp.%DATE%.log",
	datePattern: "YYYY-MM-DD",
	maxSize: "10m",
	maxFiles: 5,
	zippedArchive: true,
});

/** The winston logger instance */
const winstonLogger = winston.createLogger({
	level: "debug",
	format: logFormat,
	transports: [fileTransport],
	// Don't exit on error - logging failures shouldn't crash the app
	exitOnError: false,
});

/**
 * Centralized logger for omp.
 *
 * Logs to ~/.omp/logs/omp.YYYY-MM-DD.log with size-based rotation.
 * Safe for concurrent access from multiple omp instances.
 *
 * @example
 * ```typescript
 * import { logger } from "@oh-my-pi/pi-utils";
 *
 * logger.error("MCP request failed", { url, method });
 * logger.warn("Theme file invalid, using fallback", { path });
 * logger.debug("LSP fallback triggered", { reason });
 * ```
 */
export interface Logger {
	error(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	debug(message: string, context?: Record<string, unknown>): void;
	time<T>(op: string, fn: () => T): T;
	timeAsync<T>(op: string, fn: () => PromiseLike<T>): Promise<T>;
}

/**
 * Log an error message.
 * @param message - The message to log.
 * @param context - The context to log.
 */
export function error(message: string, context?: Record<string, unknown>): void {
	try {
		winstonLogger.error(message, context);
	} catch {
		// Silently ignore logging failures
	}
}

/**
 * Log a warning message.
 * @param message - The message to log.
 * @param context - The context to log.
 */
export function warn(message: string, context?: Record<string, unknown>): void {
	try {
		winstonLogger.warn(message, context);
	} catch {
		// Silently ignore logging failures
	}
}

/**
 * Log a debug message.
 * @param message - The message to log.
 * @param context - The context to log.
 */
export function debug(message: string, context?: Record<string, unknown>): void {
	try {
		winstonLogger.debug(message, context);
	} catch {
		// Silently ignore logging failures
	}
}

const LOGGED_TIMING_THRESHOLD_MS = 5;

const longOpBuffer = new RingBuffer<[op: string, duration: number]>(1000);
let longOpRecord = false;

function logTiming(op: string, duration: number): void {
	duration = Math.round(duration * 100) / 100;
	if (duration > LOGGED_TIMING_THRESHOLD_MS) {
		warn(`${op} done`, { duration, op });
		if (longOpRecord) {
			longOpBuffer.push([op, duration]);
		}
	} else {
		debug(`${op} done`, { duration, op });
	}
}

/**
 * Print all collected long operation timings to stderr.
 * To be called at the end of a startup or timing window.
 */
export function printTimings(): void {
	// Use stderr for timings output, do not use logger (see AGENTS.md).
	console.error("\n--- Startup Timings ---");
	let totalDuration = 0;
	for (const [op, duration] of longOpBuffer) {
		console.error(`  ${op}: ${duration}ms`);
		totalDuration += duration;
	}
	console.error(`  TOTAL: ${totalDuration}ms`);
	console.error("------------------------\n");
}

/**
 * Begin recording long operation timings.
 * Typically called at the beginning of startup.
 */
export function startTiming(): void {
	longOpBuffer.clear();
	longOpRecord = true;
}

/**
 * End timing window and print all timings.
 * Disables further buffering until next startTiming().
 */
export function endTiming(): void {
	longOpBuffer.clear();
	longOpRecord = false;
}

/**
 * Time a synchronous operation and log the duration.
 * @param op - The operation name.
 * @param fn - The function to time.
 * @returns The result of the function.
 */
export function time<T, A extends unknown[]>(op: string, fn: (...args: A) => T, ...args: A): T {
	const start = performance.now();
	try {
		return fn(...args);
	} finally {
		logTiming(op, performance.now() - start);
	}
}

/**
 * Time an asynchronous operation and log the duration.
 * @param op - The operation name.
 * @param fn - The function to time.
 * @returns The result of the function.
 */
export async function timeAsync<R, A extends unknown[]>(
	op: string,
	fn: (...args: A) => R,
	...args: A
): Promise<Awaited<R>> {
	const start = performance.now();
	try {
		return await fn(...args);
	} finally {
		logTiming(op, performance.now() - start);
	}
}
