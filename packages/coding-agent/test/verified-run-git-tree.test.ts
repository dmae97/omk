import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureCandidate } from "../src/core/verified-run/candidate.ts";
import { sealCandidateCommit } from "../src/core/verified-run/git-plumbing.ts";
import { VerifiedRunError } from "../src/core/verified-run/storage.ts";

const limits = { workMs: 1000, verifyMs: 1000, cleanupMs: 1000, maxFiles: 100, maxBytes: 65536, maxOutputBytes: 4096 };
const roots: string[] = [];

function git(root: string, args: string[]): string {
	return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "omk-git-tree-"));
	roots.push(root);
	git(root, ["init", "-q"]);
	return root;
}

function seal(root: string) {
	const snapshot = captureCandidate(root, limits);
	const zero = "0".repeat(40);
	return sealCandidateCommit(root, {
		manifest: snapshot.manifest,
		contents: snapshot.contents,
		parentOid: zero,
		zeroOid: zero,
		runId: "run-git-tree",
		candidateDigest: snapshot.digest,
		receiptDigest: "b".repeat(64),
	});
}

function treePaths(root: string, commit: string): string[] {
	return git(root, ["ls-tree", "-r", "-z", "--name-only", commit])
		.split("\0")
		.filter((path) => path.length > 0);
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("verified-run git tree identity", () => {
	it("keeps a quoted filename as a path byte, not an mktree quote (F02)", () => {
		const root = repo();
		writeFileSync(join(root, '"audit.txt"'), "quoted");
		mkdirSync(join(root, 'dir"name'), { mode: 0o755 });
		writeFileSync(join(root, 'dir"name', "note"), "nested");
		writeFileSync(join(root, "plain audit.txt"), "space");
		writeFileSync(join(root, "한글.txt"), "utf8");

		const commit = seal(root);
		expect(treePaths(root, commit).sort()).toEqual(
			['"audit.txt"', 'dir"name/note', "plain audit.txt", "한글.txt"].sort(),
		);
	});

	it("refuses a POSIX mode Git cannot represent instead of publishing a wider mode (F08)", () => {
		const root = repo();
		writeFileSync(join(root, "secret"), "hidden", { mode: 0o600 });
		expect(() => seal(root)).toThrow(VerifiedRunError);
		expect(() => seal(root)).toThrow(/mode_unrepresentable/);
	});

	it("seals the executable bit Git can represent", () => {
		const root = repo();
		writeFileSync(join(root, "run"), "#!/bin/sh\n", { mode: 0o755 });
		const commit = seal(root);
		const line = git(root, ["ls-tree", commit]);
		expect(line.startsWith("100755 blob ")).toBe(true);
		expect(line.endsWith("\trun")).toBe(true);
	});

	it("does not move the accepted ref when sealing fails", () => {
		const root = repo();
		writeFileSync(join(root, "secret"), "hidden", { mode: 0o640 });
		chmodSync(join(root, "secret"), 0o640);
		expect(() => seal(root)).toThrow(/mode_unrepresentable/);
		expect(() => git(root, ["rev-parse", "--verify", "refs/omk/accepted"])).toThrow();
	});
});
