import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateManifest } from "../src/core/verified-run/candidate.ts";
import { assertPrivateEmptyHooks, GitOperationBudget } from "../src/core/verified-run/git-execution.ts";
import { casRef, sealCandidateCommit } from "../src/core/verified-run/git-plumbing.ts";
import { digestBytes, digestObject } from "../src/core/verified-run/storage.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "git-budget-"));
	execFileSync("git", ["init", "-q", root]);
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});
const bytes = Buffer.from("same blob");
const digest = digestBytes(bytes);
function seal(budget: GitOperationBudget) {
	const manifest: CandidateManifest = {
		version: 1,
		directories: [],
		files: Array.from({ length: 100 }, (_, i) => ({ path: `file-${i}`, mode: 0o644, digest, size: bytes.length })),
	};
	return sealCandidateCommit(
		root,
		{
			manifest,
			contents: new Map([[digest, bytes]]),
			parentOid: "0".repeat(40),
			zeroOid: "0".repeat(40),
			runId: "budget",
			candidateDigest: digestObject(manifest),
			receiptDigest: "a".repeat(64),
		},
		budget,
	);
}
describe("bounded Git publication", () => {
	it("hashes repeated bytes once without omitting any tree entries", () => {
		const budget = new GitOperationBudget();
		const commit = seal(budget);
		expect(budget.commandCounts["hash-object"]).toBe(1);
		expect(
			execFileSync("git", ["-C", root, "ls-tree", "-r", "-z", "--name-only", commit], { encoding: "utf8" })
				.split("\0")
				.filter(Boolean),
		).toHaveLength(100);
	});
	it("shares one deadline instead of replenishing it per child", () => {
		let now = 0;
		const budget = new GitOperationBudget({ timeoutMs: 50, clock: () => now });
		const record = budget.record.bind(budget);
		vi.spyOn(budget, "record").mockImplementation((command) => {
			record(command);
			now = 50;
		});
		expect(() => seal(budget)).toThrow(/deadline/);
		expect(budget.commandCounts).toEqual({ "hash-object": 1 });
	});
	it("never begins a CAS after cancellation", () => {
		const commit = seal(new GitOperationBudget());
		const budget = new GitOperationBudget({ signal: AbortSignal.abort() });
		expect(() => casRef(root, "refs/omk/accepted", commit, "0".repeat(40), budget)).toThrow(/cancelled/);
		expect(budget.commandCounts).toEqual({});
	});
	it("rejects symlink, populated and shared-mode hook directories", () => {
		const dir = join(root, "hooks");
		mkdirSync(dir, { mode: 0o700 });
		chmodSync(dir, 0o700);
		expect(() => assertPrivateEmptyHooks(dir)).not.toThrow();
		const alias = join(root, "alias");
		symlinkSync(dir, alias);
		expect(() => assertPrivateEmptyHooks(alias)).toThrow(/git_hooks_boundary/);
		writeFileSync(join(dir, "reference-transaction"), "not executable");
		expect(() => assertPrivateEmptyHooks(dir)).toThrow(/git_hooks_boundary/);
		rmSync(join(dir, "reference-transaction"));
		chmodSync(dir, 0o777);
		expect(() => assertPrivateEmptyHooks(dir)).toThrow(/git_hooks_boundary/);
	});
});
