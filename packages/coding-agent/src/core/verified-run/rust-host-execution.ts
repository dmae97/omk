import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { NamespaceIdentity } from "./namespace-identity.ts";
import { prepareNativeWitnessDir } from "./native-witness.ts";
import { identityFromSandboxInfo } from "./process-gate.ts";
import type { RustHostBinding } from "./rust-host-binding.ts";
import { parseRustHostEvent, type RustHostEvent } from "./rust-host-protocol.ts";
import { releaseExitedSandboxGroup, trackSandboxGroup, untrackSandboxGroup } from "./sandbox-groups.ts";
import type { SandboxExecution, SandboxOutcome } from "./sandbox-types.ts";
import { VerifiedRunError } from "./storage.ts";
import { awaitBoundaryDrained, escalateTermination } from "./supervisor-adapter.ts";

function processFields(pid: number): string[] {
	const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
	return stat
		.slice(stat.lastIndexOf(")") + 2)
		.trim()
		.split(/\s+/);
}

/** Native owns the sandbox process; this adapter owns the native channel, never a second dispatch. */
export function executeRustSandbox(request: SandboxExecution, host: RustHostBinding): Promise<SandboxOutcome> {
	if (!request.onReady || request.gitPublication) throw new VerifiedRunError("unsupported_boundary");
	const witnessDir = request.witnessDir === undefined ? undefined : prepareNativeWitnessDir(request.witnessDir);
	const requestId = request.requestId ?? randomUUID().replaceAll("-", "");
	if (!/^[a-f0-9]{32}$/.test(requestId)) throw new VerifiedRunError("native_host_protocol");
	const recordDir = request.recordDir === undefined ? undefined : prepareNativeWitnessDir(request.recordDir);
	const started = performance.now();
	const startedAt = new Date().toISOString();
	return new Promise((resolve, reject) => {
		const child = spawn(host.path, [], { env: {}, detached: true, stdio: ["pipe", "pipe", "pipe"] });
		trackSandboxGroup(child.pid);
		let supervisor: { readonly pid: number; readonly ticks: string } | undefined;
		let identity: NamespaceIdentity | undefined;
		let readyPending = false;
		let committed = false;
		let closed = false;
		let problem: { readonly error: unknown } | undefined;
		let finish: Extract<RustHostEvent, { type: "finished" }> | undefined;
		let pending = "";
		let retained = 0;
		let diagnosticBytes = 0;
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let cancelTimer: ReturnType<typeof setTimeout> | undefined;
		const killSupervisor = (): void => {
			if (!supervisor) return;
			try {
				const fields = processFields(supervisor.pid);
				if (fields[19] === supervisor.ticks && Number(fields[2]) === supervisor.pid)
					process.kill(-supervisor.pid, "SIGKILL");
			} catch {
				/* A missing or reused PID is not signal authority. */
			}
		};
		const kill = (): void => {
			killSupervisor();
			escalateTermination(child);
		};
		const onExit = (): void => {
			if (!request.detachable || !committed) killSupervisor();
		};
		process.once("exit", onExit);
		const send = (type: "commit" | "cancel"): void => {
			if (!closed && !child.stdin.destroyed) child.stdin.write(`${JSON.stringify({ type, requestId })}\n`);
		};
		const cancel = (): void => {
			if (closed || cancelTimer) return;
			send("cancel");
			cancelTimer = setTimeout(kill, request.cleanupMs + 250);
		};
		const fail = (error: unknown): void => {
			problem ??= { error };
			cancel();
		};
		const watchdog = setTimeout(
			() => {
				problem ??= { error: new VerifiedRunError("unsettled") };
				kill();
			},
			request.timeoutMs + request.cleanupMs + 1000,
		);
		request.signal?.addEventListener("abort", cancel, { once: true });
		child.stdin.on("error", () => fail(new VerifiedRunError("native_host_disconnected")));
		child.on("error", () => fail(new VerifiedRunError("native_host_unavailable")));
		child.stderr.on("data", (bytes: Buffer) => {
			diagnosticBytes += bytes.length;
			if (diagnosticBytes > 4096) fail(new VerifiedRunError("native_host_protocol"));
		});
		const handle = (event: RustHostEvent): void => {
			if (finish) throw new VerifiedRunError("native_host_protocol");
			switch (event.type) {
				case "spawned": {
					if (supervisor || identity || !child.pid) throw new VerifiedRunError("native_host_protocol");
					const fields = processFields(event.pid);
					if (
						Number(fields[1]) !== child.pid ||
						Number(fields[2]) !== event.pid ||
						!/^\d+$/.test(fields[19] ?? "")
					)
						throw new VerifiedRunError("process_identity");
					supervisor = { pid: event.pid, ticks: fields[19] ?? "" };
					return;
				}
				case "ready": {
					if (!supervisor || identity) throw new VerifiedRunError("native_host_protocol");
					const observedIdentity = identityFromSandboxInfo(JSON.stringify(event.info));
					identity = observedIdentity;
					readyPending = true;
					Promise.resolve()
						.then(() => request.onReady?.(observedIdentity))
						.then(
							() => {
								readyPending = false;
								if (closed || finish || problem) return;
								if (request.signal?.aborted || performance.now() - started >= request.timeoutMs) {
									cancel();
									return;
								}
								committed = true;
								if (request.detachable) untrackSandboxGroup(child.pid);
								send("commit");
							},
							(error: unknown) => {
								readyPending = false;
								fail(error);
							},
						);
					return;
				}
				case "output":
					retained += event.data.length;
					if (retained > request.maxOutputBytes) throw new VerifiedRunError("native_host_protocol");
					(event.channel === "stdout" ? stdout : stderr).push(event.data);
					return;
				case "error":
					throw new VerifiedRunError(event.code);
				case "finished":
					if (event.failure === null && (!committed || event.exitCode !== 0))
						throw new VerifiedRunError("native_host_protocol");
					finish = event;
					child.stdin.end();
					return;
				default: {
					const exhaustive: never = event;
					throw new VerifiedRunError(String(exhaustive));
				}
			}
		};
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			if (problem) return;
			pending += chunk;
			try {
				let end = pending.indexOf("\n");
				while (end !== -1) {
					if (end > 65_536) throw new VerifiedRunError("native_host_protocol");
					const line = pending.slice(0, end);
					pending = pending.slice(end + 1);
					handle(parseRustHostEvent(line, requestId));
					end = pending.indexOf("\n");
				}
				if (pending.length > 65_536) throw new VerifiedRunError("native_host_protocol");
			} catch (error) {
				fail(error);
			}
		});
		child.once("exit", () => releaseExitedSandboxGroup(child.pid));
		child.once("close", (code) => {
			closed = true;
			clearTimeout(watchdog);
			clearTimeout(cancelTimer);
			request.signal?.removeEventListener("abort", cancel);
			process.removeListener("exit", onExit);
			untrackSandboxGroup(child.pid);
			if (problem || !finish || code !== 0 || pending.length > 0 || readyPending) {
				killSupervisor();
				reject(problem ? problem.error : new VerifiedRunError("unsettled"));
				return;
			}
			const outcome = finish;
			const settle = (drained: string): void => {
				if (drained !== "drained") {
					reject(new VerifiedRunError("termination_unverified"));
					return;
				}
				const durationMs = Math.max(0, Math.round(performance.now() - started));
				resolve({
					stdout: Buffer.concat(stdout),
					stderr: Buffer.concat(stderr),
					exitCode: outcome.exitCode,
					failure: outcome.failure,
					startedAt,
					finishedAt: new Date(Date.parse(startedAt) + durationMs).toISOString(),
					durationMs,
				});
			};
			if (identity) awaitBoundaryDrained(identity, request.cleanupMs).then(settle, () => settle("unknown"));
			else if (!committed) settle("drained");
			else settle("unknown");
		});
		const frame = JSON.stringify({
			version: 1,
			requestId,
			workspace: request.workspace,
			argv: request.argv,
			writable: request.writable,
			timeoutMs: Math.floor(request.timeoutMs),
			cleanupMs: request.cleanupMs,
			maxOutputBytes: request.maxOutputBytes,
			...(witnessDir === undefined ? {} : { witnessDir }),
			...(recordDir === undefined ? {} : { recordDir }),
			...(request.bindingDigest === undefined ? {} : { bindingDigest: request.bindingDigest }),
			...(request.phaseDeadline === undefined ? {} : { phaseDeadline: request.phaseDeadline }),
			...(request.detachable ? { detachable: true } : {}),
		});
		if (Buffer.byteLength(frame) + 1 > 262_144) fail(new VerifiedRunError("native_host_protocol"));
		else child.stdin.write(`${frame}\n`);
		if (request.signal?.aborted) cancel();
	});
}
