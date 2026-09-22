import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CandidateManifest } from "../src/core/verified-run/candidate.ts";
import { sealCandidateCommit } from "../src/core/verified-run/git-plumbing.ts";
import { digestBytes, digestObject } from "../src/core/verified-run/storage.ts";

let root: string;
const bytes = Buffer.from("candidate\n");
const digest = digestBytes(bytes);
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "git-preflight-"));
	execFileSync("git", ["init", "-q", root]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function seal(manifest: CandidateManifest, contents = new Map([[digest, bytes]])) {
	return sealCandidateCommit(root, {
		manifest,
		contents,
		parentOid: "0".repeat(40),
		zeroOid: "0".repeat(40),
		runId: "preflight",
		candidateDigest: digestObject(manifest),
		receiptDigest: "a".repeat(64),
	});
}
function entry(path: string, mode = 0o644) {
	return { path, mode, digest, size: bytes.length };
}
function objects() {
	return readdirSync(join(root, ".git", "objects"), { recursive: true }).sort();
}

describe("whole-candidate Git preflight", () => {
	it("rejects a late unrepresentable mode before writing even the first blob", () => {
		const before = objects();
		expect(() => seal({ version: 1, directories: [], files: [entry("first"), entry("last", 0o600)] })).toThrow(
			/mode_unrepresentable/,
		);
		expect(objects()).toEqual(before);
	});
	it.each([
		{ version: 1, directories: [], files: [entry("missing/file")] },
		{ version: 1, directories: [], files: [entry("same"), entry("same")] },
		{ version: 1, directories: ["same"], files: [entry("same")] },
		{ version: 1, directories: [], files: [entry(".env")] },
		{ version: 1, directories: [], files: [entry("../escape")] },
		{ version: 1, directories: [], files: [entry("\ud800")] },
	] satisfies CandidateManifest[])("rejects hierarchy or policy violations without object residue: %j", (manifest) => {
		const before = objects();
		expect(() => seal(manifest)).toThrow();
		expect(objects()).toEqual(before);
	});
	it("checks bytes against the declared digest, not only size", () => {
		const before = objects();
		expect(() =>
			seal({ version: 1, directories: [], files: [entry("file")] }, new Map([[digest, Buffer.alloc(bytes.length)]])),
		).toThrow(/integrity/);
		expect(objects()).toEqual(before);
	});
	it("supports SHA-256 and quote-delimited directory and file names", () => {
		const other = join(root, "sha256");
		mkdirSync(other);
		execFileSync("git", ["init", "-q", "--object-format=sha256", other]);
		const manifest: CandidateManifest = {
			version: 1,
			directories: ['"디렉터리"'],
			files: [entry('"디렉터리"/"file name"')],
		};
		const oid = sealCandidateCommit(other, {
			manifest,
			contents: new Map([[digest, bytes]]),
			parentOid: "0".repeat(64),
			zeroOid: "0".repeat(64),
			runId: "sha256",
			candidateDigest: digestObject(manifest),
			receiptDigest: "a".repeat(64),
		});
		expect(oid).toHaveLength(64);
		expect(execFileSync("git", ["-C", other, "ls-tree", "-r", "-z", "--name-only", oid], { encoding: "utf8" })).toBe(
			'"디렉터리"/"file name"\0',
		);
	});
});
