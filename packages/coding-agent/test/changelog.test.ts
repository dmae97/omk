import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ChangelogEntry, compareVersions, getNewEntries, parseChangelog } from "../src/utils/changelog.ts";

function entry(major: number, minor: number, patch: number): ChangelogEntry {
	return { major, minor, patch, content: `${major}.${minor}.${patch}` };
}

describe("parseChangelog", () => {
	let directory: string;
	let changelogPath: string;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "omk-changelog-"));
		changelogPath = join(directory, "CHANGELOG.md");
	});

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	it("parses versions and retains their headings and trimmed content through EOF", () => {
		writeFileSync(
			changelogPath,
			[
				"# Changelog",
				"",
				"## [1.5.6] - 2026-10-22",
				"",
				"### Fixed",
				"- Latest fix.",
				"",
				"## [1.5.5] - 2026-10-21",
				"- Previous fix.",
				"",
				"## [1.4.0]",
				"- Older release.",
				"",
			].join("\n"),
		);

		expect(parseChangelog(changelogPath)).toEqual([
			{ major: 1, minor: 5, patch: 6, content: "## [1.5.6] - 2026-10-22\n\n### Fixed\n- Latest fix." },
			{ major: 1, minor: 5, patch: 5, content: "## [1.5.5] - 2026-10-21\n- Previous fix." },
			{ major: 1, minor: 4, patch: 0, content: "## [1.4.0]\n- Older release." },
		]);
	});

	it("excludes unversioned sections from release content", () => {
		writeFileSync(
			changelogPath,
			"## [Unreleased]\n- Pending.\n\n## [1.5.6]\n- Released.\n\n## Notes\nNot release content.\n",
		);

		expect(parseChangelog(changelogPath)).toEqual([
			{ major: 1, minor: 5, patch: 6, content: "## [1.5.6]\n- Released." },
		]);
	});

	it("returns no entries when the changelog does not exist", () => {
		expect(parseChangelog(changelogPath)).toEqual([]);
	});
});

describe("compareVersions", () => {
	it.each([
		{ component: "major", newer: entry(3, 0, 0), older: entry(1, 9, 9) },
		{ component: "minor", newer: entry(1, 8, 0), older: entry(1, 5, 9) },
		{ component: "patch", newer: entry(1, 5, 8), older: entry(1, 5, 5) },
	])("compares the $component component before lower components", ({ newer, older }) => {
		expect(compareVersions(newer, older)).toBeGreaterThan(0);
		expect(compareVersions(older, newer)).toBeLessThan(0);
	});

	it("returns zero for equal versions regardless of content", () => {
		expect(compareVersions(entry(1, 5, 6), { ...entry(1, 5, 6), content: "Different notes" })).toBe(0);
	});
});

describe("getNewEntries", () => {
	const entries = [entry(2, 0, 0), entry(1, 6, 0), entry(1, 5, 6), entry(1, 5, 5), entry(1, 5, 0), entry(1, 0, 0)];

	it("returns only entries strictly newer than the last version", () => {
		expect(getNewEntries(entries, "1.5.5")).toEqual([entries[0], entries[1], entries[2]]);
	});

	it("defaults a missing patch component to zero", () => {
		expect(getNewEntries(entries, "1.5")).toEqual([entries[0], entries[1], entries[2], entries[3]]);
	});

	it("defaults missing minor and patch components to zero", () => {
		expect(getNewEntries(entries, "1")).toEqual(entries.slice(0, 5));
	});

	it("returns no entries when all releases are at or below the last version", () => {
		expect(getNewEntries(entries, "2.0.0")).toEqual([]);
	});

	it("returns no entries for an empty changelog", () => {
		expect(getNewEntries([], "1.5.5")).toEqual([]);
	});
});
