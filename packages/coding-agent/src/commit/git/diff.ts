import type { FileDiff, NumstatEntry } from "$c/commit/types";

export function parseNumstat(output: string): NumstatEntry[] {
	const entries: NumstatEntry[] = [];
	for (const line of output.split("\n")) {
		if (!line.trim()) continue;
		const parts = line.split("\t");
		if (parts.length < 3) continue;
		const [addedRaw, deletedRaw, pathRaw] = parts;
		const additions = Number.parseInt(addedRaw, 10);
		const deletions = Number.parseInt(deletedRaw, 10);
		const path = extractPathFromRename(pathRaw);
		entries.push({
			path,
			additions: Number.isNaN(additions) ? 0 : additions,
			deletions: Number.isNaN(deletions) ? 0 : deletions,
		});
	}
	return entries;
}

export function parseFileDiffs(diff: string): FileDiff[] {
	const sections: FileDiff[] = [];
	const parts = diff.split("\ndiff --git ");
	for (let index = 0; index < parts.length; index += 1) {
		const part = index === 0 ? parts[index] : `diff --git ${parts[index]}`;
		if (!part.trim()) continue;
		const lines = part.split("\n");
		const header = lines[0] ?? "";
		const match = header.match(/diff --git a\/(.+?) b\/(.+)$/);
		if (!match) continue;
		const filename = match[2];
		const content = part;
		const isBinary = lines.some((line) => line.startsWith("Binary files "));
		let additions = 0;
		let deletions = 0;
		for (const line of lines) {
			if (line.startsWith("+++") || line.startsWith("---")) continue;
			if (line.startsWith("+")) additions += 1;
			else if (line.startsWith("-")) deletions += 1;
		}
		sections.push({
			filename,
			content,
			additions,
			deletions,
			isBinary,
		});
	}
	return sections;
}

function extractPathFromRename(pathPart: string): string {
	const braceStart = pathPart.indexOf("{");
	if (braceStart !== -1) {
		const arrowPos = pathPart.indexOf(" => ", braceStart);
		if (arrowPos !== -1) {
			const braceEnd = pathPart.indexOf("}", arrowPos);
			if (braceEnd !== -1) {
				const prefix = pathPart.slice(0, braceStart);
				const newName = pathPart.slice(arrowPos + 4, braceEnd).trim();
				return `${prefix}${newName}`;
			}
		}
	}

	if (pathPart.includes(" => ")) {
		const parts = pathPart.split(" => ");
		return parts[1]?.trim() ?? pathPart.trim();
	}

	return pathPart.trim();
}
