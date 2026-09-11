import type { RunDagTask } from "omk-protocol";
import { type CandidateFile, type CandidateSnapshot, loadCandidate } from "./candidate.ts";
import type { RunPhaseContext } from "./phase-context.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";

// Match captureCandidate's depth-first, per-directory code-unit ordering (not locale ordering).
function treeOrder(left: string, right: string): number {
	const a = left.split("/");
	const b = right.split("/");
	for (let index = 0; index < Math.min(a.length, b.length); index++) {
		if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
	}
	return a.length - b.length;
}

/** Compose only the declared ancestors' disjoint output scopes, over the pinned original input. */
export function composeDagCandidate(
	context: Pick<RunPhaseContext, "runPath" | "contract"> & {
		readonly journal: Pick<RunPhaseContext["journal"], "state">;
	},
	selected: readonly RunDagTask[],
): CandidateSnapshot {
	const { contract, journal, runPath } = context;
	if (!journal.state.inputDigest) throw new VerifiedRunError("input_checkpoint_missing");
	const base = loadCandidate(runPath, journal.state.inputDigest, contract.budget);
	const files = new Map<string, CandidateFile>(base.manifest.files.map((file) => [file.path, file]));
	const directories = new Set(base.manifest.directories);
	const blobs = new Map(base.contents);
	for (const definition of selected) {
		const task = journal.state.tasks.find((task) => task.taskId === definition.id);
		if (task?.status !== "succeeded") throw new VerifiedRunError("task_not_ready");
		const output = loadCandidate(runPath, task.outputDigest, contract.budget);
		const owned = (path: string): boolean =>
			definition.writablePaths.some((scope) => path === scope || path.startsWith(`${scope}/`));
		for (const path of files.keys()) if (owned(path)) files.delete(path);
		for (const path of directories) if (owned(path)) directories.delete(path);
		for (const path of output.manifest.directories) if (owned(path)) directories.add(path);
		for (const file of output.manifest.files) {
			if (!owned(file.path)) continue;
			const bytes = output.contents.get(file.digest);
			if (!bytes) throw new VerifiedRunError("integrity");
			files.set(file.path, file);
			blobs.set(file.digest, bytes);
		}
	}
	const entries = [...files.values()].sort((a, b) => treeOrder(a.path, b.path));
	if (
		entries.length + directories.size > contract.budget.maxFiles ||
		entries.reduce((sum, file) => sum + file.size, 0) > contract.budget.maxBytes
	)
		throw new VerifiedRunError("storage_limit");
	const manifest = Object.freeze({
		version: 1 as const,
		directories: Object.freeze([...directories].sort(treeOrder)),
		files: Object.freeze(entries),
	});
	const contents = new Map<string, Buffer>();
	for (const file of entries) {
		const bytes = blobs.get(file.digest);
		if (!bytes) throw new VerifiedRunError("integrity");
		contents.set(file.digest, bytes);
	}
	return { manifest, digest: digestObject(manifest), contents };
}
