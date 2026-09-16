import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { release } from "node:os";
import { performance } from "node:perf_hooks";
import type { RunContract } from "omk-protocol";
import type { NamespaceIdentity } from "./namespace-identity.ts";
import { identityFromSandboxInfo, PROCESS_GATE_ARGV } from "./process-gate.ts";
import { digestBytes, digestObject, VerifiedRunError } from "./storage.ts";

const BWRAP = "/usr/bin/bwrap";
const SYSTEM_ARGS = [
	"--unshare-all",
	"--die-with-parent",
	"--new-session",
	"--cap-drop",
	"ALL",
	"--clearenv",
	"--ro-bind",
	"/usr",
	"/usr",
	"--symlink",
	"usr/bin",
	"/bin",
	"--symlink",
	"usr/lib",
	"/lib",
	"--symlink",
	"usr/lib64",
	"/lib64",
	"--proc",
	"/proc",
	"--dev",
	"/dev",
	"--tmpfs",
	"/tmp",
	"--setenv",
	"PATH",
	"/usr/bin:/bin",
	"--setenv",
	"LANG",
	"C.UTF-8",
] as const;

export interface SandboxExecution {
	readonly workspace: string;
	readonly argv: readonly string[];
	readonly writable: boolean;
	readonly timeoutMs: number;
	readonly cleanupMs: number;
	readonly maxOutputBytes: number;
	readonly signal?: AbortSignal;
	readonly onReady?: (identity: NamespaceIdentity) => void | Promise<void>;
}
export interface SandboxOutcome {
	readonly stdout: Buffer;
	readonly stderr: Buffer;
	readonly exitCode: number | null;
	readonly failure: string | null;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly durationMs: number;
}

export function commandEnvironmentDigest(contract: RunContract, driver: "legacy" | "gated-v1" = "legacy"): string {
	if (process.platform !== "linux" || !existsSync(BWRAP)) throw new VerifiedRunError("unsupported");
	let writers: readonly (readonly string[])[];
	switch (contract.profile) {
		case "linux-command-v1":
			writers = [contract.writer];
			break;
		case "linux-scripted-agent-v1":
			writers = contract.writer.steps;
			break;
		case "linux-command-dag-v1":
			writers = contract.writer.tasks.flatMap((task) => task.attempts);
			break;
		default: {
			const exhaustive: never = contract;
			throw new VerifiedRunError(String(exhaustive));
		}
	}
	const binaries = [
		...new Set([
			BWRAP,
			...writers.map((argv) => argv[0]),
			...contract.checks.map((check) => check.argv[0]),
			...(driver === "gated-v1" ? [PROCESS_GATE_ARGV[0]] : []),
		]),
	];
	const materials = binaries.map((binary) => {
		if (!binary || (!binary.startsWith("/usr/bin/") && !binary.startsWith("/bin/")))
			throw new VerifiedRunError("unsupported_executable");
		const path = realpathSync(binary);
		if (!path.startsWith("/usr/")) throw new VerifiedRunError("unsupported_executable");
		return { path, digest: digestBytes(readFileSync(path)) };
	});
	return digestObject({
		profile: contract.profile,
		platform: process.platform,
		architecture: process.arch,
		kernel: release(),
		sandbox: SYSTEM_ARGS,
		...(driver === "gated-v1" ? { gate: PROCESS_GATE_ARGV, infoFd: 3 } : {}),
		binaries: materials,
	});
}

export function probeVerifiedSandbox(): void {
	if (process.platform !== "linux" || !existsSync(BWRAP)) throw new VerifiedRunError("unsupported");
	const probe = spawnSync(BWRAP, [...SYSTEM_ARGS, "--", "/bin/true"], {
		env: {},
		timeout: 3000,
		maxBuffer: 4096,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (probe.error || probe.status !== 0) throw new VerifiedRunError("unsupported");
}

/** The only process dispatch port; close means the PID namespace and its inherited pipes have drained. */
export async function executeSandbox(request: SandboxExecution): Promise<SandboxOutcome> {
	if (request.signal?.aborted) throw new VerifiedRunError("cancelled");
	if (request.timeoutMs <= 0) throw new VerifiedRunError("deadline");
	const started = performance.now();
	const startedAt = new Date().toISOString();
	const argv = [
		...SYSTEM_ARGS,
		request.writable ? "--bind" : "--ro-bind",
		request.workspace,
		"/workspace",
		"--chdir",
		"/workspace",
		...(request.onReady ? ["--info-fd", "3", "--", ...PROCESS_GATE_ARGV] : ["--"]),
		...request.argv,
	];
	return new Promise((resolve, reject) => {
		const child = request.onReady
			? spawn(BWRAP, argv, { env: {}, stdio: ["pipe", "pipe", "pipe", "pipe"] })
			: spawn(BWRAP, argv, { env: {}, stdio: ["ignore", "pipe", "pipe"] });
		let gateFailed = false;
		let gateError: unknown;
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let size = 0;
		let failure: string | null = null;
		let cleanup: ReturnType<typeof setTimeout> | undefined;
		let finished = false;
		const stop = (reason: string): void => {
			if (finished || failure) return;
			failure = reason;
			child.kill("SIGKILL");
			// When the gate already failed, surface its real cause rather than a
			// generic unsettled — the close handler may still arrive first, and
			// either path must report the same error.
			cleanup = setTimeout(
				() =>
					reject(
						gateFailed ? (gateError ?? new VerifiedRunError("unsettled")) : new VerifiedRunError("unsettled"),
					),
				request.cleanupMs,
			);
		};
		const deadline = setTimeout(() => stop("deadline"), request.timeoutMs);
		const abort = (): void => stop("cancelled");
		request.signal?.addEventListener("abort", abort, { once: true });
		if (request.signal?.aborted) abort();
		const collect = (target: Buffer[], chunk: Buffer): void => {
			if (failure) return;
			size += chunk.length;
			if (size > request.maxOutputBytes) {
				stop("output_limit");
				return;
			}
			target.push(chunk);
		};
		child.stdout?.on("data", (chunk: Buffer) => collect(stdout, chunk));
		child.stderr?.on("data", (chunk: Buffer) => collect(stderr, chunk));
		if (request.onReady) {
			const info = child.stdio[3];
			let metadata = "";
			if (!info || !child.stdin) {
				gateFailed = true;
				gateError = new VerifiedRunError("process_identity");
				stop("process_identity");
			} else {
				child.stdin.on("error", () => stop("execution_failed"));
				info.on("data", (chunk: Buffer) => {
					metadata += chunk.toString("utf8");
					if (metadata.length > 4096) stop("process_identity");
				});
				info.once("end", async () => {
					if (finished || failure) return;
					try {
						await request.onReady?.(identityFromSandboxInfo(metadata));
						if (performance.now() - started >= request.timeoutMs || request.signal?.aborted)
							stop(request.signal?.aborted ? "cancelled" : "deadline");
						if (!finished && !failure) child.stdin?.end("go\n");
					} catch (error) {
						gateFailed = true;
						gateError = error;
						stop("process_identity");
					}
				});
			}
		}
		child.once("error", () => {
			failure = "execution_failed";
		});
		child.once("close", (exitCode) => {
			finished = true;
			clearTimeout(deadline);
			clearTimeout(cleanup);
			request.signal?.removeEventListener("abort", abort);
			if (gateFailed) {
				reject(gateError);
				return;
			}
			const durationMs = Math.max(0, Math.round(performance.now() - started));
			resolve({
				stdout: Buffer.concat(stdout),
				stderr: Buffer.concat(stderr),
				exitCode,
				failure: failure ?? (exitCode === 0 ? null : "execution_failed"),
				startedAt,
				// Project the finish instant from the start's wall reference and monotonic elapsed time.
				finishedAt: new Date(Date.parse(startedAt) + durationMs).toISOString(),
				durationMs,
			});
		});
	});
}
