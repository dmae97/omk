import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { type NamespaceIdentity, probeNamespace } from "./namespace-identity.ts";
import { VerifiedRunError } from "./storage.ts";

/**
 * Owned-process supervisor boundary (WP02).
 *
 * Three concerns are separated here so the broker only orchestrates them:
 *
 * - spawn: `SUPERVISOR_SYSTEM_ARGS` + `loadSupervisorBackend` describe the only
 *   backend this package trusts — bubblewrap with `--unshare-all`, which puts
 *   the supervised command in a fresh PID namespace whose init is the only
 *   process the host can see. A platform without that backend has no way to
 *   prove termination, so callers must refuse with `unsupported_boundary`
 *   instead of degrading to best-effort signaling.
 * - cancel: `escalateTermination` sends SIGKILL to the supervised direct
 *   child (the bwrap supervisor). `--die-with-parent` propagates death to the
 *   namespace init, and the kernel then SIGKILLs every remaining task in that
 *   namespace — including non-cooperative workers and detached (`setsid`)
 *   descendants. Signal delivery is never treated as termination.
 * - termination witness: `probeNamespace` detects the recorded namespace
 *   init's death and `awaitBoundaryDrained` waits for it. When a PID
 *   namespace's init exits, the kernel SIGKILLs every remaining task in that
 *   namespace, so init death is the exact termination witness — a `close`
 *   event, a resolved promise, or a dead direct child with surviving
 *   descendants is not. `namespaceMemberPids` remains as a diagnostic
 *   enumeration only: host process-table scans are environment-dependent
 *   (zombies keep their ns link until reaped; foreign same-uid tasks can be
 *   unreadable) and have poisoned drains on kernels where either occurs.
 */
export const SUPERVISOR_BINARY = "/usr/bin/bwrap";

export const SUPERVISOR_SYSTEM_ARGS = [
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

export type SupervisorChild = { readonly kill: (signal: NodeJS.Signals) => boolean };

/**
 * The only termination guarantee this package honors: a private PID namespace
 * plus the Linux bwrap supervisor. Anything else is refused at the boundary.
 */
export function loadSupervisorBackend(): { readonly binary: string; readonly args: readonly string[] } {
	if (process.platform !== "linux" || !existsSync(SUPERVISOR_BINARY))
		throw new VerifiedRunError("unsupported_boundary");
	return { binary: SUPERVISOR_BINARY, args: SUPERVISOR_SYSTEM_ARGS };
}

/**
 * SIGKILL escalation to the supervised direct child. `--die-with-parent` makes
 * the kernel kill the whole PID namespace once this supervisor dies, so no
 * per-descendant signaling (which PID reuse would make unsafe) is needed.
 */
export function escalateTermination(child: SupervisorChild): void {
	child.kill("SIGKILL");
}

/**
 * Enumerate host PIDs of every task still inside `identity.namespace`.
 *
 * Membership is keyed on the recorded namespace symlink, not on the init's
 * PID: a fabricated or reaped direct child cannot mask surviving descendants.
 *
 * A task whose namespace link cannot be read is only a candidate member when
 * it could belong to the recorded boundary at all. The backend's members
 * always run under our real uid — the pid namespace is owned by a user
 * namespace we created and `CAP_SETUID` is dropped — so a task owned by
 * another uid, or one that vanished mid-scan, cannot be a member and is
 * skipped. An unreadable task owned by our uid is conservatively counted:
 * failing to prove emptiness must fail closed.
 */
export function namespaceMemberPids(identity: Pick<NamespaceIdentity, "namespace">): number[] {
	const members: number[] = [];
	// A platform without getuid cannot exclude foreign-owned tasks, so every
	// unreadable entry stays a candidate member (fail closed).
	const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
	for (const entry of readdirSync("/proc")) {
		if (!/^\d+$/.test(entry)) continue;
		try {
			if (readlinkSync(`/proc/${entry}/ns/pid`) !== identity.namespace) continue;
			// A zombie still carries the namespace link until reaped, but it
			// cannot run: counting it as a member confuses teardown with
			// survival.
			const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
			const state = stat
				.slice(stat.lastIndexOf(")") + 2)
				.trim()
				.split(/\s+/)[0];
			if (state !== "Z" && state !== "X") members.push(Number(entry));
		} catch (error) {
			if (!(error instanceof Error && "code" in error)) continue;
			if (error.code === "ENOENT" || error.code === "ESRCH") continue;
			try {
				if (uid === undefined || statSync(`/proc/${entry}`).uid === uid) members.push(Number(entry));
			} catch (statError) {
				if (
					!(statError instanceof Error && "code" in statError) ||
					(statError.code !== "ENOENT" && statError.code !== "ESRCH")
				)
					members.push(Number(entry));
			}
		}
	}
	return members;
}

/** Init death terminates the whole namespace; a zombie init already proves teardown finished. */
export function probeOwnedNamespace(identity: NamespaceIdentity): "terminated" | "alive" | "unknown" {
	const status = probeNamespace(identity);
	return status === "gone" ? "terminated" : status;
}

/**
 * Wait for the namespace init's death within budgetMs. Init death is the
 * termination witness: the kernel SIGKILLs every remaining task in the PID
 * namespace when its init exits, so a drained namespace needs no process-table
 * enumeration. `populated`/`unknown` never release claims.
 */
export async function awaitBoundaryDrained(
	identity: NamespaceIdentity,
	budgetMs: number,
): Promise<"drained" | "populated" | "unknown"> {
	const deadline = performance.now() + Math.max(0, budgetMs);
	for (;;) {
		const status = probeNamespace(identity);
		if (status === "gone") return "drained";
		if (status === "unknown") return "unknown";
		if (performance.now() >= deadline) return "populated";
		await delay(Math.min(10, Math.max(1, deadline - performance.now())));
	}
}
