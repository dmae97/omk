import type { SessionTreeEntry } from "../types.ts";

export function updateLabelCache(labelsById: Map<string, string>, entry: SessionTreeEntry): void {
	if (entry.type !== "label") return;
	const label = entry.label?.trim();
	if (label) labelsById.set(entry.targetId, label);
	else labelsById.delete(entry.targetId);
}

export function buildLabelsById(entries: SessionTreeEntry[]): Map<string, string> {
	const labelsById = new Map<string, string>();
	for (const entry of entries) updateLabelCache(labelsById, entry);
	return labelsById;
}
