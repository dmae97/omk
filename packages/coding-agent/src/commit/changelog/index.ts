import { relative, resolve } from "node:path";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import { logger } from "@oh-my-pi/pi-utils";
import { detectChangelogBoundaries } from "$c/commit/changelog/detect";
import { generateChangelogEntries } from "$c/commit/changelog/generate";
import { parseUnreleasedSection } from "$c/commit/changelog/parse";
import type { ControlledGit } from "$c/commit/git";

const CHANGELOG_SECTIONS = ["Breaking Changes", "Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

const DEFAULT_MAX_DIFF_CHARS = 120_000;

export interface ChangelogFlowInput {
	git: ControlledGit;
	cwd: string;
	model: Model<Api>;
	apiKey: string;
	stagedFiles: string[];
	dryRun: boolean;
	maxDiffChars?: number;
	onProgress?: (message: string) => void;
}

/**
 * Update CHANGELOG.md entries for staged changes.
 */
export async function runChangelogFlow({
	git,
	cwd,
	model,
	apiKey,
	stagedFiles,
	dryRun,
	maxDiffChars,
	onProgress,
}: ChangelogFlowInput): Promise<string[]> {
	if (stagedFiles.length === 0) return [];
	onProgress?.("Detecting changelog boundaries...");
	const boundaries = await detectChangelogBoundaries(cwd, stagedFiles);
	if (boundaries.length === 0) return [];

	const updated: string[] = [];
	for (const boundary of boundaries) {
		onProgress?.(`Generating entries for ${boundary.changelogPath}...`);
		const diff = await git.getDiffForFiles(boundary.files, true);
		if (!diff.trim()) continue;
		const stat = await git.getStatForFiles(boundary.files, true);
		const diffForPrompt = truncateDiff(diff, maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS);
		const changelogContent = await Bun.file(boundary.changelogPath).text();
		let unreleased: { startLine: number; endLine: number; entries: Record<string, string[]> };
		try {
			unreleased = parseUnreleasedSection(changelogContent);
		} catch (error) {
			logger.warn("commit changelog parse skipped", { path: boundary.changelogPath, error: String(error) });
			continue;
		}
		const existingEntries = formatExistingEntries(unreleased.entries);
		const isPackageChangelog = resolve(boundary.changelogPath) !== resolve(cwd, "CHANGELOG.md");
		const generated = await generateChangelogEntries({
			model,
			apiKey,
			changelogPath: boundary.changelogPath,
			isPackageChangelog,
			existingEntries: existingEntries || undefined,
			stat,
			diff: diffForPrompt,
		});
		if (Object.keys(generated.entries).length === 0) continue;

		const updatedContent = applyChangelogEntries(changelogContent, unreleased, generated.entries);
		if (!dryRun) {
			await Bun.write(boundary.changelogPath, updatedContent);
			await git.stageFiles([relative(cwd, boundary.changelogPath)]);
		}
		updated.push(boundary.changelogPath);
	}

	return updated;
}

function truncateDiff(diff: string, maxChars: number): string {
	if (diff.length <= maxChars) return diff;
	return `${diff.slice(0, maxChars)}\n... (truncated)`;
}

function formatExistingEntries(entries: Record<string, string[]>): string {
	const lines: string[] = [];
	for (const section of CHANGELOG_SECTIONS) {
		const values = entries[section] ?? [];
		if (values.length === 0) continue;
		lines.push(`${section}:`);
		for (const value of values) {
			lines.push(`- ${value}`);
		}
	}
	return lines.join("\n");
}

function applyChangelogEntries(
	content: string,
	unreleased: { startLine: number; endLine: number; entries: Record<string, string[]> },
	entries: Record<string, string[]>,
): string {
	const lines = content.split("\n");
	const before = lines.slice(0, unreleased.startLine + 1);
	const after = lines.slice(unreleased.endLine);

	const merged = mergeEntries(unreleased.entries, entries);
	const sectionLines = renderUnreleasedSections(merged);
	return [...before, ...sectionLines, ...after].join("\n");
}

function mergeEntries(
	existing: Record<string, string[]>,
	incoming: Record<string, string[]>,
): Record<string, string[]> {
	const merged: Record<string, string[]> = { ...existing };
	for (const [section, items] of Object.entries(incoming)) {
		const current = merged[section] ?? [];
		const lower = new Set(current.map((item) => item.toLowerCase()));
		for (const item of items) {
			if (!lower.has(item.toLowerCase())) {
				current.push(item);
			}
		}
		merged[section] = current;
	}
	return merged;
}

function renderUnreleasedSections(entries: Record<string, string[]>): string[] {
	const lines: string[] = [""];
	for (const section of CHANGELOG_SECTIONS) {
		const items = entries[section] ?? [];
		if (items.length === 0) continue;
		lines.push(`### ${section}`);
		for (const item of items) {
			lines.push(`- ${item}`);
		}
		lines.push("");
	}
	if (lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
}
