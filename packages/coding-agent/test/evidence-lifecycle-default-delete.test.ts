/**
 * Default-config (OMK_EVIDENCE_LIFECYCLE unset ⇒ `delete`) safety: spec 118 conditional delete removes only
 * verified goal-recall files of the current session inside `<cwd>/.omk/goals/recall`. Never files outside the
 * workspace, never another session's files, never user-created files.
 */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	evidenceLifecycleMode,
	resetEvidenceLifecycleForTest,
	updateEvidenceArtifact,
} from "../src/core/evidence-lifecycle.ts";
import {
	deleteEvidenceArtifact,
	lookupEvidence,
	resetEvidenceDeleteForTest,
} from "../src/core/evidence-lifecycle-delete.ts";
import { resetEvidenceScopeForTest, withEvidenceSession } from "../src/core/evidence-lifecycle-scope.ts";
import { OutputArtifactWriter, outputRecallDir } from "../src/core/goal-output-recall.ts";
import { observeRecallRecheck } from "../src/core/goal-output-recall-evidence.ts";

const roots: string[] = [];
function temp(prefix: string): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	roots.push(root);
	return root;
}
function recall(cwd: string, goalId: string) {
	const writer = OutputArtifactWriter.open({ cwd, goalId, round: 0, revision: 1 });
	writer?.write(Buffer.from("raw output\nF821\n"));
	const artifact = writer?.finish();
	if (artifact === undefined) throw new Error("recall not written");
	return artifact;
}

beforeEach(() => {
	resetEvidenceLifecycleForTest();
	resetEvidenceDeleteForTest();
	resetEvidenceScopeForTest();
	vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", undefined);
});
afterEach(() => {
	vi.unstubAllEnvs();
	resetEvidenceLifecycleForTest();
	resetEvidenceDeleteForTest();
	resetEvidenceScopeForTest();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("OMK_EVIDENCE_LIFECYCLE default", () => {
	it("unset and 1 select delete; observe records only; 0/false/off opt out; typos never delete", () => {
		expect(evidenceLifecycleMode({})).toBe("delete");
		expect(evidenceLifecycleMode({ OMK_EVIDENCE_LIFECYCLE: "1" })).toBe("delete");
		expect(evidenceLifecycleMode({ OMK_EVIDENCE_LIFECYCLE: "observe" })).toBe("observe");
		for (const v of ["0", "false", "off", " OFF "])
			expect(evidenceLifecycleMode({ OMK_EVIDENCE_LIFECYCLE: v })).toBe("off");
		for (const v of ["Delete", "true", "delete ", ""]) {
			expect(evidenceLifecycleMode({ OMK_EVIDENCE_LIFECYCLE: v })).toBe("observe");
		}
	});

	it("default deletes a verified recall file of this session", () => {
		const cwd = temp("omk-ev-default-");
		const a = withEvidenceSession("s1", () => {
			const artifact = recall(cwd, "g");
			observeRecallRecheck("g", true);
			return artifact;
		});
		expect(existsSync(a.absolutePath)).toBe(false);
		expect(lookupEvidence(a.absolutePath)).toBe("deleted_after_use");
	});

	it("=0 restores the old behavior: nothing is deleted", () => {
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "0");
		const cwd = temp("omk-ev-default-");
		const a = withEvidenceSession("s1", () => {
			const artifact = recall(cwd, "g");
			observeRecallRecheck("g", true);
			return artifact;
		});
		expect(existsSync(a.absolutePath)).toBe(true);
	});
});

describe("default delete safety", () => {
	it("never deletes outside the workspace: a recall dir symlinked out of the workspace is refused", () => {
		const cwd = temp("omk-ev-ws-");
		const outside = temp("omk-ev-outside-");
		mkdirSync(join(cwd, ".omk", "goals"), { recursive: true });
		symlinkSync(outside, join(cwd, ".omk", "goals", "recall"));
		withEvidenceSession("s1", () => {
			recall(cwd, "g");
			observeRecallRecheck("g", true);
		});
		const logs = readdirSync(outside).filter((n) => n.endsWith(".log"));
		expect(logs).toHaveLength(1);
	});

	it("never deletes another session's recall files", () => {
		const cwd = temp("omk-ev-ws-");
		const a = withEvidenceSession("session-a", () => {
			const artifact = recall(cwd, "g");
			updateEvidenceArtifact(artifact.absolutePath, {
				consumed: ["repair-turn", "acceptance-recheck"],
				verified: true,
				goalActive: false,
			});
			return artifact;
		});
		withEvidenceSession("session-b", () => {
			observeRecallRecheck("g", true);
			expect(deleteEvidenceArtifact("ev-1")).toMatchObject({ deleted: false });
		});
		expect(existsSync(a.absolutePath)).toBe(true);
	});

	it("never deletes user-created files, even recall-named ones or files beside recall output", () => {
		const cwd = temp("omk-ev-ws-");
		writeFileSync(join(cwd, "notes.txt"), "user");
		const userInRecall = join(outputRecallDir(cwd), "acceptance-g-9-9-9.log");
		const beside = join(outputRecallDir(cwd), "user-notes.md");
		withEvidenceSession("s1", () => {
			recall(cwd, "g");
			writeFileSync(userInRecall, "user-made");
			writeFileSync(beside, "user-made");
			observeRecallRecheck("g", true);
		});
		expect(readFileSync(join(cwd, "notes.txt"), "utf8")).toBe("user");
		expect(readFileSync(userInRecall, "utf8")).toBe("user-made");
		expect(readFileSync(beside, "utf8")).toBe("user-made");
	});
});
