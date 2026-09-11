import { readFileSync, readlinkSync } from "node:fs";
import { readRunClock } from "./recovery-clock.ts";
import { VerifiedRunError } from "./storage.ts";

export interface NamespaceIdentity {
	readonly pid: number;
	readonly startTicks: string;
	readonly namespace: string;
	readonly bootId: string;
}

export function parseNamespaceIdentity(raw: unknown): NamespaceIdentity {
	if (
		typeof raw !== "object" ||
		raw === null ||
		!("pid" in raw) ||
		typeof raw.pid !== "number" ||
		!Number.isSafeInteger(raw.pid) ||
		raw.pid <= 0 ||
		!("startTicks" in raw) ||
		typeof raw.startTicks !== "string" ||
		!/^\d+$/.test(raw.startTicks) ||
		raw.startTicks.length > 32 ||
		!("namespace" in raw) ||
		typeof raw.namespace !== "string" ||
		!/^pid:\[\d+\]$/.test(raw.namespace) ||
		!("bootId" in raw) ||
		typeof raw.bootId !== "string" ||
		!/^[a-f0-9-]{36}$/.test(raw.bootId)
	)
		throw new VerifiedRunError("integrity");
	return Object.freeze({ pid: raw.pid, startTicks: raw.startTicks, namespace: raw.namespace, bootId: raw.bootId });
}

function processStat(pid: number): { readonly startTicks: string; readonly state: string } {
	const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
	const fields = stat
		.slice(stat.lastIndexOf(")") + 2)
		.trim()
		.split(/\s+/);
	const startTicks = fields[19];
	const state = fields[0];
	if (!startTicks || !/^\d+$/.test(startTicks) || !state) throw new VerifiedRunError("process_identity");
	return { startTicks, state };
}

export function captureNamespaceIdentity(pid: number): NamespaceIdentity {
	if (!Number.isSafeInteger(pid) || pid <= 0) throw new VerifiedRunError("process_identity");
	const before = processStat(pid);
	const status = readFileSync(`/proc/${pid}/status`, "utf8");
	const namespacePids = status
		.match(/^NSpid:\s+(.+)$/m)?.[1]
		?.trim()
		.split(/\s+/);
	if (!namespacePids || namespacePids.length < 2 || namespacePids.at(-1) !== "1")
		throw new VerifiedRunError("process_identity");
	const namespace = readlinkSync(`/proc/${pid}/ns/pid`);
	const after = processStat(pid);
	if (before.startTicks !== after.startTicks || before.state === "Z" || after.state === "Z")
		throw new VerifiedRunError("process_identity");
	return parseNamespaceIdentity({ pid, startTicks: before.startTicks, namespace, bootId: readRunClock().bootId });
}

/** Read only. Never signal a PID that may have been reused by another process. */
export function probeNamespace(identity: NamespaceIdentity): "alive" | "gone" | "unknown" {
	try {
		if (readRunClock().bootId !== identity.bootId) return "unknown";
	} catch {
		return "unknown";
	}
	try {
		const current = processStat(identity.pid);
		if (current.startTicks !== identity.startTicks) return "gone";
		// Linux finishes PID namespace teardown before its init becomes a zombie.
		if (current.state === "Z" || current.state === "X") return "gone";
		return readlinkSync(`/proc/${identity.pid}/ns/pid`) === identity.namespace ? "alive" : "unknown";
	} catch (error) {
		if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ESRCH"))
			return "gone";
		return "unknown";
	}
}
