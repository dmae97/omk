/**
 * Source-directed dependency scan with the read/read no-conflict invariant.
 * The existing conflict predicate stays authoritative for paths, aliases,
 * exclusive barriers, and custom resource kinds.
 *
 * O(n + n*w + E) time, O(n + E) memory, where w is the number of entries
 * not proved read-only and E is the output edge count. Worst case stays O(n²).
 * `isReadOnly` must mean that any two entries it accepts cannot conflict.
 */
export function buildReadAwareDependencies<T>(
	entries: readonly T[],
	isReadOnly: (entry: T) => boolean,
	conflicts: (earlier: T, current: T) => boolean,
): number[][] {
	const priorWriters: number[] = [];
	const dependencies: number[][] = [];
	for (let index = 0; index < entries.length; index++) {
		const current = entries[index];
		const readOnly = isReadOnly(current);
		const blockers: number[] = [];
		if (readOnly) {
			for (const earlier of priorWriters) {
				if (conflicts(entries[earlier], current)) blockers.push(earlier);
			}
		} else {
			for (let earlier = 0; earlier < index; earlier++) {
				if (conflicts(entries[earlier], current)) blockers.push(earlier);
			}
			priorWriters.push(index);
		}
		dependencies.push(blockers);
	}
	return dependencies;
}
