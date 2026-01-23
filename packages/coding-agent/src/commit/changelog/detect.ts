import { dirname, resolve } from "node:path";
import type { ChangelogBoundary } from "@oh-my-pi/pi-coding-agent/commit/types";

const CHANGELOG_NAME = "CHANGELOG.md";

export async function detectChangelogBoundaries(cwd: string, stagedFiles: string[]): Promise<ChangelogBoundary[]> {
	const boundaries = new Map<string, string[]>();
	for (const file of stagedFiles) {
		if (file.toLowerCase().endsWith("changelog.md")) continue;
		const changelogPath = await findNearestChangelog(cwd, file);
		if (!changelogPath) continue;
		const list = boundaries.get(changelogPath) ?? [];
		list.push(file);
		boundaries.set(changelogPath, list);
	}

	return Array.from(boundaries.entries()).map(([changelogPath, files]) => ({
		changelogPath,
		files,
	}));
}

async function findNearestChangelog(cwd: string, filePath: string): Promise<string | null> {
	let current = resolve(cwd, dirname(filePath));
	const root = resolve(cwd);
	while (true) {
		const candidate = resolve(current, CHANGELOG_NAME);
		if (await Bun.file(candidate).exists()) {
			return candidate;
		}
		if (current === root) return null;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}
