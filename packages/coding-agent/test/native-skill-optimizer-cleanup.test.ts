import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { parsePatch } from "diff";
import { describe, expect, it, vi } from "vitest";

const [patch] = parsePatch(
	readFileSync(fileURLToPath(new URL("../resources/native-skill-optimizer/3.1.2.patch", import.meta.url)), "utf8"),
);
const body = patch.hunks
	.flatMap((hunk) => hunk.lines.filter((line) => !line.startsWith("-")).map((line) => line.slice(1)))
	.join("\n");
const script = new Script(
	`${body.replace("export function", "function").replace("options: TemporaryOutputArchiveOptions = {}): number", "options = {})")}; cleanupTemporaryOutputs;`,
);

function harness(expiresAt: number, valid = true) {
	const state = { expiresAt, valid, renew: false, symlink: false };
	const deleted: string[] = [];
	const lock = vi.fn((_paths: string[], callback: () => boolean) => {
		if (state.renew) state.expiresAt = 5000;
		return callback();
	});
	const cleanup = script.runInNewContext({
		archiveDirectory: () => "/archives",
		archiveNow: () => 2000,
		readdirSync: () => [{ name: `${"a".repeat(43)}.txt`, isFile: () => true }],
		OUTPUT_ARCHIVE_FILE_RE: /^([A-Za-z0-9_-]{43})\.txt$/,
		join,
		outputArchiveMetadataPath: (directory: string, digest: string) => join(directory, `${digest}.meta.json`),
		lstatSync: () => ({ mtimeMs: 1000, isFile: () => !state.symlink, isSymbolicLink: () => state.symlink }),
		readArchiveExpiry: () => ({ valid: state.valid, expiresAt: state.expiresAt }),
		withFileLocks: lock,
		unlinkSync: (path: string) => deleted.push(path),
	}) as () => number;
	return { state, lock, cleanup, deleted };
}

describe("shipped optimizer cleanup repair", () => {
	it("skips live archives without durable write locks", () => {
		const h = harness(3000);
		expect(h.cleanup()).toBe(0);
		expect(h.lock).not.toHaveBeenCalled();
		expect(h.deleted).toEqual([]);
	});

	it("skips invalid metadata without durable write locks", () => {
		const h = harness(1000, false);
		expect(h.cleanup()).toBe(0);
		expect(h.lock).not.toHaveBeenCalled();
		expect(h.deleted).toEqual([]);
	});

	it("retains locking for expired archive deletion", () => {
		const h = harness(1000);
		expect(h.cleanup()).toBe(1);
		expect(h.lock).toHaveBeenCalledOnce();
		expect(h.deleted).toEqual([`/archives/${"a".repeat(43)}.txt`, `/archives/${"a".repeat(43)}.meta.json`]);
	});

	it("rechecks a lease renewed between the optimistic read and lock acquisition", () => {
		const h = harness(1000);
		h.state.renew = true;
		expect(h.cleanup()).toBe(0);
		expect(h.lock).toHaveBeenCalledOnce();
		expect(h.deleted).toEqual([]);
	});

	it("keeps the locked symlink rejection", () => {
		const h = harness(1000);
		h.state.symlink = true;
		expect(h.cleanup()).toBe(0);
		expect(h.deleted).toEqual([]);
	});
});
