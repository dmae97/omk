export interface ParentLinkedEntry {
	readonly id: string;
	readonly parentId: string | null;
}

/** Recoverable error raised when persisted session entries contain a parent cycle or corrupt tree link. */
export class SessionTreeIntegrityError extends Error {
	readonly code = "SESSION_PARENT_CYCLE" as const;
	readonly entryId: string;

	constructor(message: string, entryId: string) {
		super(message);
		this.name = "SessionTreeIntegrityError";
		this.entryId = entryId;
	}
}

/** Validate that no entry in the session forms a self-parent or multi-node parent cycle. */
export function validateSessionParentTree<T extends ParentLinkedEntry>(
	entries: readonly T[],
	byId: ReadonlyMap<string, T>,
): void {
	const safe = new Set<string>();
	const maxSteps = Math.max(1, entries.length, byId.size);
	for (const entry of entries) {
		if (safe.has(entry.id)) continue;
		const visiting = new Set<string>();
		let current: T | undefined = entry;
		let steps = 0;
		while (current) {
			if (safe.has(current.id)) break;
			if (visiting.has(current.id)) {
				throw new SessionTreeIntegrityError(
					`Corrupted session parent cycle detected at entry "${current.id}". Original file preserved.`,
					current.id,
				);
			}
			if (++steps > maxSteps) {
				throw new SessionTreeIntegrityError(
					`Corrupted session parent chain exceeded bound (${maxSteps}) at entry "${current.id}". Original file preserved.`,
					current.id,
				);
			}
			visiting.add(current.id);
			current = current.parentId ? byId.get(current.parentId) : undefined;
		}
		for (const id of visiting) safe.add(id);
	}
}

/** Walk from `leaf` to root with visited tracking and a finite step bound (root-first order). */
export function walkParentBranchSafely<T extends ParentLinkedEntry>(
	leaf: T,
	byId: ReadonlyMap<string, T>,
	maxSteps = Math.max(1, byId.size),
): T[] {
	const path: T[] = [];
	const visited = new Set<string>();
	let current: T | undefined = leaf;
	let steps = 0;
	while (current) {
		if (visited.has(current.id)) {
			throw new SessionTreeIntegrityError(
				`Corrupted session parent cycle detected at entry "${current.id}". Original file preserved.`,
				current.id,
			);
		}
		if (++steps > maxSteps) {
			throw new SessionTreeIntegrityError(
				`Corrupted session parent traversal exceeded bound (${maxSteps}) at entry "${current.id}". Original file preserved.`,
				current.id,
			);
		}
		visited.add(current.id);
		path.push(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return path.reverse();
}
