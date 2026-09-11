import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertCandidateScope, captureCandidate } from "../src/core/verified-run/candidate.ts";
import { assertStateOutsideWorkspace } from "../src/core/verified-run/storage.ts";

let root: string;
const limits = { workMs: 1000, verifyMs: 1000, cleanupMs: 1000, maxFiles: 100, maxBytes: 65536, maxOutputBytes: 4096 };
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "candidate-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("candidate material identity", () => {
	it("preserves BOM-prefixed UTF-8 filenames as distinct input paths", () => {
		writeFileSync(join(root, "file"), "one");
		writeFileSync(join(root, "\ufefffile"), "two");
		const snapshot = captureCandidate(root, limits);
		expect(snapshot.manifest.files.map((file) => file.path)).toEqual(["file", "\ufefffile"]);
	});

	it("rejects unsupported directory modes instead of silently normalizing them", () => {
		mkdirSync(join(root, "private"), { mode: 0o700 });
		expect(() => captureCandidate(root, limits)).toThrow(/file_type/);
	});

	it("binds file modes and blocks mode changes outside write scope", () => {
		writeFileSync(join(root, "script"), "same bytes", { mode: 0o644 });
		const before = captureCandidate(root, limits);
		chmodSync(join(root, "script"), 0o755);
		const after = captureCandidate(root, limits);
		expect(after.digest).not.toBe(before.digest);
		expect(() => assertCandidateScope(before.manifest, after.manifest, ["other"])).toThrow(/scope_changed/);
	});

	it("binds deletions rather than treating absent output as unchanged", () => {
		writeFileSync(join(root, "file"), "delete me");
		const before = captureCandidate(root, limits);
		rmSync(join(root, "file"));
		const after = captureCandidate(root, limits);
		expect(() => assertCandidateScope(before.manifest, after.manifest, ["other"])).toThrow(/scope_changed/);
		expect(() => assertCandidateScope(before.manifest, after.manifest, ["file"])).not.toThrow();
	});

	it("includes empty and binary untracked input bytes", () => {
		writeFileSync(join(root, "empty"), "");
		writeFileSync(join(root, "binary"), Buffer.from([0, 255, 128]));
		const snapshot = captureCandidate(root, limits);
		expect(snapshot.manifest.files.map((file) => file.size)).toEqual([3, 0]);
	});

	it("refuses hardlinks and symlinks rather than sharing writable bytes", () => {
		writeFileSync(join(root, "original"), "same");
		linkSync(join(root, "original"), join(root, "hardlink"));
		expect(() => captureCandidate(root, limits)).toThrow(/file_type/);
	});

	it("refuses incomplete scopes when count or byte caps are exhausted", () => {
		writeFileSync(join(root, "one"), "123");
		writeFileSync(join(root, "two"), "456");
		expect(() => captureCandidate(root, { ...limits, maxFiles: 1 })).toThrow(/storage_limit/);
		expect(() => captureCandidate(root, { ...limits, maxBytes: 5 })).toThrow(/storage_limit/);
	});

	it("rejects state under the workspace, including symlink aliases", () => {
		const workspace = join(root, "workspace");
		mkdirSync(workspace);
		const alias = join(root, "alias");
		symlinkSync(workspace, alias);
		expect(() => assertStateOutsideWorkspace(join(alias, "state"), workspace)).toThrow(/state_scope/);
		expect(() => assertStateOutsideWorkspace(join(root, "state"), workspace)).not.toThrow();
	});
});
