/**
 * Process groups of sandboxes this process launched and has not yet seen close.
 * Detached spawning takes bwrap out of the owner's terminal foreground group,
 * so a terminal SIGINT no longer reaches it directly. Owner death is already
 * covered by bwrap's --die-with-parent, and the CLI turns SIGINT/SIGTERM into a
 * witnessed cancel; this exit hook additionally SIGKILLs any group still live
 * when the owner exits (including the pre-arm init window), without installing
 * signal handlers that would change the owner's default signal behavior.
 */
const liveSandboxGroups = new Set<number>();
let exitHookInstalled = false;

export function trackSandboxGroup(pid: number | undefined): void {
	if (pid === undefined) return;
	liveSandboxGroups.add(pid);
	if (exitHookInstalled) return;
	exitHookInstalled = true;
	process.once("exit", () => {
		for (const group of liveSandboxGroups) {
			try {
				process.kill(-group, "SIGKILL");
			} catch {
				// Group already gone.
			}
		}
		liveSandboxGroups.clear();
	});
}

export function untrackSandboxGroup(pid: number | undefined): void {
	if (pid !== undefined) liveSandboxGroups.delete(pid);
}

/**
 * Called when the group leader is reaped. From then on its PID is free for
 * reuse as soon as no group member is left, so an empty group is dropped now
 * rather than at `close`, which can lag while an escaped descendant holds the
 * pipes. The exit hook then never signals a group number the kernel may have
 * handed out again. A group that still has members keeps its number reserved.
 */
export function releaseExitedSandboxGroup(pid: number | undefined): void {
	if (pid !== undefined && !sandboxGroupPopulated(pid)) liveSandboxGroups.delete(pid);
}

/** Sandbox groups still awaiting reap; exposed so tests can prove the set drains. */
export function liveSandboxGroupCount(): number {
	return liveSandboxGroups.size;
}

function sandboxGroupPopulated(group: number): boolean {
	try {
		process.kill(-group, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}
