/**
 * System information collection for debug reports.
 */
import * as os from "node:os";
import { VERSION } from "../config";

export interface SystemInfo {
	os: string;
	arch: string;
	cpu: string;
	memory: {
		total: number;
		free: number;
	};
	versions: {
		app: string;
		bun: string;
		node: string;
	};
	cwd: string;
	shell: string;
	terminal: string | undefined;
}

/** Collect system information */
export async function collectSystemInfo(): Promise<SystemInfo> {
	const cpus = os.cpus();
	const cpuModel = cpus[0]?.model ?? "Unknown CPU";

	// Try to get shell from environment
	const shell = Bun.env.SHELL ?? Bun.env.ComSpec ?? "unknown";
	const terminal = Bun.env.TERM_PROGRAM ?? Bun.env.TERM ?? undefined;

	return {
		os: `${os.type()} ${os.release()} (${os.platform()})`,
		arch: os.arch(),
		cpu: cpuModel,
		memory: {
			total: os.totalmem(),
			free: os.freemem(),
		},
		versions: {
			app: VERSION,
			bun: Bun.version,
			node: process.version,
		},
		cwd: process.cwd(),
		shell,
		terminal,
	};
}

/** Format bytes to human-readable string */
function formatBytes(bytes: number): string {
	const gb = bytes / (1024 * 1024 * 1024);
	return `${gb.toFixed(1)} GB`;
}

/** Format system info for display */
export function formatSystemInfo(info: SystemInfo): string {
	const lines = [
		"System Information",
		"━━━━━━━━━━━━━━━━━━",
		`OS:      ${info.os}`,
		`Arch:    ${info.arch}`,
		`CPU:     ${info.cpu}`,
		`Memory:  ${formatBytes(info.memory.total)} (${formatBytes(info.memory.free)} free)`,
		`Bun:     ${info.versions.bun}`,
		`App:     omp ${info.versions.app}`,
		`Node:    ${info.versions.node} (compat)`,
		`CWD:     ${info.cwd}`,
		`Shell:   ${info.shell}`,
	];
	if (info.terminal) {
		lines.push(`Terminal: ${info.terminal}`);
	}
	return lines.join("\n");
}

/** Sanitize environment variables by redacting sensitive values */
export function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string> {
	const SENSITIVE_PATTERNS = [/key/i, /secret/i, /token/i, /pass/i, /auth/i, /credential/i, /api/i, /private/i];

	const result: Record<string, string> = {};
	for (const [k, v] of Object.entries(env)) {
		if (v === undefined) continue;
		const isSensitive = SENSITIVE_PATTERNS.some(p => p.test(k));
		result[k] = isSensitive ? "[REDACTED]" : v;
	}
	return result;
}
