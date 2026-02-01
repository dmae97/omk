/**
 * Debug report bundle creation.
 *
 * Creates a .tar.gz archive with session data, logs, system info, and optional profiling data.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { WorkProfile } from "@oh-my-pi/pi-natives/work";
import { isEnoent } from "@oh-my-pi/pi-utils";
import type { CpuProfile, HeapSnapshot } from "./profiler";
import { collectSystemInfo, sanitizeEnv } from "./system-info";

/** Reports directory path */
export function getReportsDir(): string {
	return path.join(os.homedir(), ".omp", "reports");
}

/** Get today's log file path */
function getLogPath(): string {
	const today = new Date().toISOString().slice(0, 10);
	return path.join(os.homedir(), ".omp", "logs", `omp.${today}.log`);
}

/** Read last N lines from a file */
async function readLastLines(filePath: string, n: number): Promise<string> {
	try {
		const content = await Bun.file(filePath).text();
		const lines = content.split("\n");
		return lines.slice(-n).join("\n");
	} catch (err) {
		if (isEnoent(err)) return "";
		throw err;
	}
}

export interface ReportBundleOptions {
	/** Session file path */
	sessionFile: string | undefined;
	/** Settings to include */
	settings?: Record<string, unknown>;
	/** CPU profile (for performance reports) */
	cpuProfile?: CpuProfile;
	/** Heap snapshot (for memory reports) */
	heapSnapshot?: HeapSnapshot;
	/** Work profile (for work scheduling reports) */
	workProfile?: WorkProfile;
}

export interface ReportBundleResult {
	path: string;
	files: string[];
}

/**
 * Create a debug report bundle.
 *
 * Bundle contents:
 * - session.jsonl: Current session transcript
 * - artifacts/: Session artifacts directory
 * - subagents/: Subagent sessions + artifacts
 * - logs.txt: Recent log entries
 * - system.json: OS, arch, CPU, memory, versions
 * - env.json: Sanitized environment variables
 * - config.json: Resolved settings
 * - profile.cpuprofile: CPU profile (performance report only)
 * - profile.md: Markdown CPU profile (performance report only)
 * - heap.heapsnapshot: Heap snapshot (memory report only)
 * - work.folded: Work profile folded stacks (work report only)
 * - work.md: Work profile summary (work report only)
 * - work.svg: Work profile flamegraph (work report only)
 */
export async function createReportBundle(options: ReportBundleOptions): Promise<ReportBundleResult> {
	const reportsDir = getReportsDir();
	await fs.mkdir(reportsDir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const outputPath = path.join(reportsDir, `omp-report-${timestamp}.tar.gz`);

	const data: Record<string, string> = {};
	const files: string[] = [];

	// Collect system info
	const systemInfo = await collectSystemInfo();
	data["system.json"] = JSON.stringify(systemInfo, null, 2);
	files.push("system.json");

	// Sanitized environment
	data["env.json"] = JSON.stringify(sanitizeEnv(process.env as Record<string, string>), null, 2);
	files.push("env.json");

	// Settings/config
	if (options.settings) {
		data["config.json"] = JSON.stringify(options.settings, null, 2);
		files.push("config.json");
	}

	// Recent logs (last 1000 lines)
	const logPath = getLogPath();
	const logs = await readLastLines(logPath, 1000);
	if (logs) {
		data["logs.txt"] = logs;
		files.push("logs.txt");
	}

	// Session file
	if (options.sessionFile) {
		try {
			const sessionContent = await Bun.file(options.sessionFile).text();
			data["session.jsonl"] = sessionContent;
			files.push("session.jsonl");
		} catch {
			// Session file might not exist yet
		}

		// Artifacts directory (same path without .jsonl)
		const artifactsDir = options.sessionFile.slice(0, -6);
		await addDirectoryToArchive(data, files, artifactsDir, "artifacts");

		// Look for subagent sessions in the same directory
		const sessionDir = path.dirname(options.sessionFile);
		const sessionBasename = path.basename(options.sessionFile, ".jsonl");
		await addSubagentSessions(data, files, sessionDir, sessionBasename);
	}

	// CPU profile
	if (options.cpuProfile) {
		data["profile.cpuprofile"] = options.cpuProfile.data;
		files.push("profile.cpuprofile");
		data["profile.md"] = options.cpuProfile.markdown;
		files.push("profile.md");
	}

	// Heap snapshot
	if (options.heapSnapshot) {
		data["heap.heapsnapshot"] = options.heapSnapshot.data;
		files.push("heap.heapsnapshot");
	}

	// Work profile
	if (options.workProfile) {
		data["work.folded"] = options.workProfile.folded;
		files.push("work.folded");
		data["work.md"] = options.workProfile.summary;
		files.push("work.md");
		if (options.workProfile.svg) {
			data["work.svg"] = options.workProfile.svg;
			files.push("work.svg");
		}
	}

	// Write archive
	await Bun.Archive.write(outputPath, data, { compress: "gzip" });

	return { path: outputPath, files };
}

/** Add all files from a directory to the archive */
async function addDirectoryToArchive(
	data: Record<string, string>,
	files: string[],
	dirPath: string,
	archivePrefix: string,
): Promise<void> {
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const filePath = path.join(dirPath, entry.name);
			const archivePath = `${archivePrefix}/${entry.name}`;
			try {
				const content = await Bun.file(filePath).text();
				data[archivePath] = content;
				files.push(archivePath);
			} catch {
				// Skip files we can't read
			}
		}
	} catch {
		// Directory doesn't exist
	}
}

/** Find and add subagent session files */
async function addSubagentSessions(
	data: Record<string, string>,
	files: string[],
	sessionDir: string,
	parentBasename: string,
): Promise<void> {
	// Subagent sessions are named with task IDs in the same directory
	// They follow the pattern: {timestamp}_{sessionId}.jsonl
	// We look for any sessions created after the parent session
	try {
		const entries = await fs.readdir(sessionDir, { withFileTypes: true });
		const sessionFiles = entries
			.filter(e => e.isFile() && e.name.endsWith(".jsonl") && e.name !== `${parentBasename}.jsonl`)
			.map(e => e.name);

		// Limit to most recent 10 subagent sessions
		const sortedFiles = sessionFiles.sort().slice(-10);

		for (const filename of sortedFiles) {
			const filePath = path.join(sessionDir, filename);
			const archivePath = `subagents/${filename}`;
			try {
				const content = await Bun.file(filePath).text();
				data[archivePath] = content;
				files.push(archivePath);

				// Also add artifacts for this subagent session
				const artifactsDir = filePath.slice(0, -6);
				await addDirectoryToArchive(data, files, artifactsDir, `subagents/${filename.slice(0, -6)}`);
			} catch {
				// Skip files we can't read
			}
		}
	} catch {
		// Directory doesn't exist
	}
}

/** Get recent log entries for display */
export async function getRecentLogs(lines: number): Promise<string> {
	const logPath = getLogPath();
	return readLastLines(logPath, lines);
}

/** Calculate total size of artifact cache */
export async function getArtifactCacheStats(
	sessionsDir: string,
): Promise<{ count: number; totalSize: number; oldestDate: Date | null }> {
	let count = 0;
	let totalSize = 0;
	let oldestDate: Date | null = null;

	try {
		const sessions = await fs.readdir(sessionsDir, { withFileTypes: true });

		for (const session of sessions) {
			// Artifact directories don't have .jsonl extension
			if (session.isDirectory()) {
				const dirPath = path.join(sessionsDir, session.name);
				try {
					const stat = await fs.stat(dirPath);
					const files = await fs.readdir(dirPath);
					for (const file of files) {
						const filePath = path.join(dirPath, file);
						const fileStat = await fs.stat(filePath);
						if (fileStat.isFile()) {
							count++;
							totalSize += fileStat.size;
						}
					}
					if (!oldestDate || stat.mtime < oldestDate) {
						oldestDate = stat.mtime;
					}
				} catch {
					// Skip inaccessible directories
				}
			}
		}
	} catch {
		// Directory doesn't exist
	}

	return { count, totalSize, oldestDate };
}

/** Clear artifact cache older than N days */
export async function clearArtifactCache(sessionsDir: string, daysOld: number = 30): Promise<{ removed: number }> {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - daysOld);
	let removed = 0;

	try {
		const sessions = await fs.readdir(sessionsDir, { withFileTypes: true });

		for (const session of sessions) {
			if (session.isDirectory()) {
				const dirPath = path.join(sessionsDir, session.name);
				try {
					const stat = await fs.stat(dirPath);
					if (stat.mtime < cutoff) {
						await fs.rm(dirPath, { recursive: true, force: true });
						removed++;
					}
				} catch {
					// Skip inaccessible directories
				}
			}
		}
	} catch {
		// Directory doesn't exist
	}

	return { removed };
}
