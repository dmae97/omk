import { CodexDiscoveryInterrupted, codexUltraAvailable } from "./codex-ultra-catalog.ts";
import { runCodexTask } from "./codex-ultra-exec.ts";
import { readCodexVersion } from "./codex-ultra-version.ts";

const USAGE =
	"Usage: printf 'task' | omk codex-ultra\nRuns a separate non-interactive Codex CLI session. OMK session context and permissions are not transferred.";
const MAX_TASK_BYTES = 1_000_000;

export function supportedCodexVersion(output: string): boolean {
	const match = /(?:codex-cli|codex)\s+(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(output);
	if (!match) return false;
	const [major, minor] = [Number(match[1]), Number(match[2])];
	return major > 0 || minor >= 159;
}

export async function runCodexUltraCommand(args: string[]): Promise<{ handled: boolean; exitCode: number }> {
	if (args[0] !== "codex-ultra") return { handled: false, exitCode: 0 };
	return { handled: true, exitCode: await runCodexUltra(args.slice(1)) };
}

export async function runCodexUltra(args: readonly string[], input?: string): Promise<number> {
	if (args.length) {
		if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
			process.stdout.write(`${USAGE}\n`);
			return 0;
		}
		process.stderr.write(`${USAGE}\n`);
		return 2;
	}
	if (process.platform === "win32") {
		process.stderr.write(
			"Codex Ultra currently requires macOS, Linux, or WSL. Native Windows launch is not verified.\n",
		);
		return 1;
	}
	let task = input;
	if (task === undefined) {
		if (process.stdin.isTTY) {
			process.stderr.write(`${USAGE}\n`);
			return 2;
		}
		const chunks: Buffer[] = [];
		let total = 0;
		for await (const chunk of process.stdin) {
			const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			total += data.length;
			if (total > MAX_TASK_BYTES) {
				process.stderr.write("Task exceeds the 1 MB input limit.\n");
				return 2;
			}
			chunks.push(data);
		}
		task = Buffer.concat(chunks).toString("utf8");
	}
	if (!task.trim() || Buffer.byteLength(task) > MAX_TASK_BYTES) {
		process.stderr.write("Provide a non-empty task of at most 1 MB on stdin.\n");
		return 2;
	}
	const binary = "codex";
	let version: string;
	try {
		version = await readCodexVersion(binary);
	} catch (error) {
		process.stderr.write("Codex version check failed. Install Codex CLI 0.159.0 or later and sign in.\n");
		return error instanceof CodexDiscoveryInterrupted ? error.exitCode : 1;
	}
	if (!supportedCodexVersion(version)) {
		process.stderr.write("Codex CLI 0.159.0 or later is required for GPT-6.1 Terra.\n");
		return 1;
	}
	let available: boolean;
	try {
		available = await codexUltraAvailable(binary);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : "Codex model discovery failed"}.\n`);
		return error instanceof CodexDiscoveryInterrupted ? error.exitCode : 1;
	}
	if (!available) {
		process.stderr.write(
			"The Codex model list did not advertise GPT-6.1 Terra with Ultra and multi-agent v2. No session started.\n",
		);
		return 1;
	}
	process.stderr.write(
		"Starting a separate non-interactive Codex session. Codex's own approvals and sandbox settings apply.\n",
	);
	return runCodexTask(binary, task);
}
