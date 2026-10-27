import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	evidenceLifecycleDeleteEnabled,
	evidenceLifecycleMode,
	evidenceLifecycleObserveEnabled,
	listEvidenceArtifacts,
	resetEvidenceLifecycleForTest,
	updateEvidenceArtifact,
} from "../src/core/evidence-lifecycle.ts";
import {
	acquireEvidenceLease,
	deleteEvidenceArtifact,
	evidenceDeleteFs,
	evidenceDeletionLogPath,
	lookupEvidence,
	recoverEvidenceDeletions,
	resetEvidenceDeleteForTest,
} from "../src/core/evidence-lifecycle-delete.ts";
import { evidenceLifecycleReport } from "../src/core/evidence-lifecycle-report.ts";
import {
	EVIDENCE_UNATTRIBUTED,
	resetEvidenceScopeForTest,
	withEvidenceSession,
} from "../src/core/evidence-lifecycle-scope.ts";
import { RECALL_COUNTER_FILE, recallCounterFs } from "../src/core/evidence-recall-counter.ts";
import {
	deleteGoalRecallFiles,
	OUTPUT_RECALL_PER_GOAL,
	OutputArtifactWriter,
	outputRecallDir,
} from "../src/core/goal-output-recall.ts";
import { observeRecallBlockedExhausted, observeRecallRecheck } from "../src/core/goal-output-recall-evidence.ts";
import {
	DELETED_RECALL_LINK,
	MISSING_RECALL_LINK,
	rewriteRecallLinks,
	rewriteRecallLinksInMessages,
} from "../src/core/goal-output-recall-links.ts";

const SECRET = "SECRET-RAW-OUTPUT-d2-91c4";
const roots: string[] = [];

function tempCwd(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "omk-ev-del-")));
	roots.push(root);
	return root;
}

function recall(cwd: string, goalId: string, round = 0, text = `${SECRET}\nF821\n`) {
	const writer = OutputArtifactWriter.open({ cwd, goalId, round, revision: 1 });
	writer?.write(Buffer.from(text));
	const artifact = writer?.finish();
	if (artifact === undefined) throw new Error("recall not written");
	return artifact;
}

function recordOf(artifactNumber: number) {
	return listEvidenceArtifacts(EVIDENCE_UNATTRIBUTED).find((r) => r.artifactId === `ev-${artifactNumber}`);
}

function logLines(cwd: string): Record<string, unknown>[] {
	const log = evidenceDeletionLogPath(outputRecallDir(cwd), EVIDENCE_UNATTRIBUTED);
	try {
		return readFileSync(log, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	} catch {
		return [];
	}
}

const original = { ...evidenceDeleteFs };
const originalRename = recallCounterFs.rename;

beforeEach(() => {
	resetEvidenceLifecycleForTest();
	resetEvidenceDeleteForTest();
	vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "delete");
});

afterEach(() => {
	vi.unstubAllEnvs();
	Object.assign(evidenceDeleteFs, original);
	recallCounterFs.rename = originalRename;
	resetEvidenceLifecycleForTest();
	resetEvidenceDeleteForTest();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("spec 118 flag", () => {
	it("delete implies observe; unset, 1 and delete select delete; unknown values are observe, never delete (G13)", () => {
		for (const value of [undefined, "1", "delete"]) {
			expect(evidenceLifecycleMode({ OMK_EVIDENCE_LIFECYCLE: value })).toBe("delete");
		}
		for (const value of ["Delete", "true", "delete ", ""]) {
			expect(evidenceLifecycleMode({ OMK_EVIDENCE_LIFECYCLE: value })).toBe("observe");
			expect(evidenceLifecycleDeleteEnabled({ OMK_EVIDENCE_LIFECYCLE: value })).toBe(false);
		}
		for (const value of ["0", "false", "off", " Off "]) {
			expect(evidenceLifecycleMode({ OMK_EVIDENCE_LIFECYCLE: value })).toBe("off");
			expect(evidenceLifecycleObserveEnabled({ OMK_EVIDENCE_LIFECYCLE: value })).toBe(false);
		}
		expect(evidenceLifecycleMode({ OMK_EVIDENCE_LIFECYCLE: "observe" })).toBe("observe");
		expect(evidenceLifecycleDeleteEnabled({ OMK_EVIDENCE_LIFECYCLE: "observe" })).toBe(false);
		expect(evidenceLifecycleObserveEnabled({ OMK_EVIDENCE_LIFECYCLE: "delete" })).toBe(true);
		expect(evidenceLifecycleDeleteEnabled({ OMK_EVIDENCE_LIFECYCLE: "delete" })).toBe(true);
	});

	it.each([
		["unknown value", "Delete"],
		["observe", "observe"],
	])("%s: a passing recheck deletes nothing and writes no sidecar", (_n, value) => {
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", value);
		const cwd = tempCwd();
		const artifact = recall(cwd, "g");
		observeRecallRecheck("g", true);
		expect(lookupEvidence(artifact.absolutePath)).toBe("present");
		expect(readdirSync(outputRecallDir(cwd))).not.toContain(RECALL_COUNTER_FILE);
	});
});

describe("spec 118 D2 eligibility (G1)", () => {
	it("verified passing recheck ACKs both consumers and deletes the recall file", () => {
		const cwd = tempCwd();
		const artifact = recall(cwd, "g");
		observeRecallRecheck("g", true);
		expect(lookupEvidence(artifact.absolutePath)).toBe("deleted_after_use");
		expect(recordOf(1)?.status).toBe("deleted_after_use");
		expect(evidenceLifecycleReport(EVIDENCE_UNATTRIBUTED)).toMatchObject({ mode: "delete", deletes: 1 });
	});

	it("EV1: one of two consumers ACKed ⇒ kept", () => {
		const cwd = tempCwd();
		const artifact = recall(cwd, "g");
		updateEvidenceArtifact(artifact.absolutePath, { consumed: ["repair-turn"], verified: true, goalActive: false });
		expect(deleteEvidenceArtifact("ev-1")).toEqual({ deleted: false, reason: "hold-awaiting-consumer" });
		expect(lookupEvidence(artifact.absolutePath)).toBe("present");
	});

	it("EV2: reads are not ACK ⇒ kept", () => {
		const cwd = tempCwd();
		const artifact = recall(cwd, "g");
		const release = acquireEvidenceLease(artifact.absolutePath);
		release();
		expect(deleteEvidenceArtifact("ev-1").deleted).toBe(false);
		expect(lookupEvidence(artifact.absolutePath)).toBe("present");
	});

	it("EV3: retry / recovery holds and failing rechecks ⇒ kept", () => {
		const cwd = tempCwd();
		const a = recall(cwd, "g");
		observeRecallRecheck("g", false);
		expect(lookupEvidence(a.absolutePath)).toBe("present");
		updateEvidenceArtifact(a.absolutePath, { recoveryHold: true });
		observeRecallRecheck("g", true);
		expect(lookupEvidence(a.absolutePath)).toBe("present");
		expect(deleteEvidenceArtifact("ev-1").reason).toBe("hold-recovery");
	});

	it("terminal failure diagnostics (blocked/exhausted) are never deleted in D2", () => {
		const cwd = tempCwd();
		const a = recall(cwd, "g");
		observeRecallBlockedExhausted("g");
		observeRecallRecheck("g", true);
		expect(lookupEvidence(a.absolutePath)).toBe("present");
		expect(deleteEvidenceArtifact("ev-1").reason).toBe("terminal-diagnostic");
	});

	it("active reader lease blocks delete until released", () => {
		const cwd = tempCwd();
		const a = recall(cwd, "g");
		const release = acquireEvidenceLease(a.absolutePath);
		observeRecallRecheck("g", true);
		expect(lookupEvidence(a.absolutePath)).toBe("present");
		release();
		expect(deleteEvidenceArtifact("ev-1").deleted).toBe(true);
	});
});

describe("spec 118 D2 race and restart (G2, G3)", () => {
	it("G2: delete with a stale version loses to a new consumer", () => {
		const cwd = tempCwd();
		const a = recall(cwd, "g");
		updateEvidenceArtifact(a.absolutePath, {
			consumed: ["repair-turn", "acceptance-recheck"],
			verified: true,
			goalActive: false,
		});
		updateEvidenceArtifact(a.absolutePath, { retryHold: false });
		expect(deleteEvidenceArtifact("ev-1", 0)).toEqual({ deleted: false, reason: "cas" });
		expect(lookupEvidence(a.absolutePath)).toBe("present");
	});

	it("G3: crash after intent (before unlink) ⇒ restart recovery converges", () => {
		const cwd = tempCwd();
		const a = recall(cwd, "g");
		evidenceDeleteFs.unlink = () => {
			throw Object.assign(new Error("crash"), { code: "ECRASH" });
		};
		observeRecallRecheck("g", true);
		Object.assign(evidenceDeleteFs, original);
		// The pending path appended `aborted`; simulate a hard crash by dropping it.
		const log = evidenceDeletionLogPath(outputRecallDir(cwd), EVIDENCE_UNATTRIBUTED);
		const kept = logLines(cwd).filter((entry) => entry.event === "intent");
		writeFileSync(log, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
		resetEvidenceLifecycleForTest(); // process restart: in-memory records gone
		expect(recoverEvidenceDeletions(outputRecallDir(cwd))).toBe(1);
		expect(existsSync(a.absolutePath)).toBe(false);
		// Restarted registry is empty; the durable log answers the lookup.
		expect(lookupEvidence(a.absolutePath)).toBe("deleted_after_use");
		expect(logLines(cwd).at(-1)).toMatchObject({ event: "deleted", reason: "recovered" });
		expect(recoverEvidenceDeletions(outputRecallDir(cwd))).toBe(0);
	});

	it("G3: crash after unlink (no `deleted` line) ⇒ recovery records it, file state matches", () => {
		const cwd = tempCwd();
		const a = recall(cwd, "g");
		let appends = 0;
		evidenceDeleteFs.append = (path, line) => {
			appends += 1;
			if (appends > 1) throw new Error("crash");
			original.append(path, line);
		};
		observeRecallRecheck("g", true);
		Object.assign(evidenceDeleteFs, original);
		expect(lookupEvidence(a.absolutePath)).toBe("deleted_after_use");
		expect(recoverEvidenceDeletions(outputRecallDir(cwd))).toBe(1);
		expect(logLines(cwd).map((e) => e.event)).toEqual(["intent", "deleted"]);
	});
});

describe("spec 118 D2 fs faults (G4)", () => {
	for (const code of ["EACCES", "EBUSY", "EIO"]) {
		it(`${code}: delete_pending with reason, ≤3 attempts, never deleted`, () => {
			const cwd = tempCwd();
			const a = recall(cwd, "g");
			let calls = 0;
			evidenceDeleteFs.unlink = () => {
				calls += 1;
				throw Object.assign(new Error(code), { code });
			};
			observeRecallRecheck("g", true);
			for (let i = 0; i < 5; i++) deleteEvidenceArtifact("ev-1");
			expect(calls).toBe(3);
			expect(recordOf(1)).toMatchObject({ status: "delete_pending", deleteReason: code });
			expect(lookupEvidence(a.absolutePath)).toBe("present");
			expect(deleteEvidenceArtifact("ev-1").reason).toBe("retries-exhausted");
			expect(evidenceLifecycleReport(EVIDENCE_UNATTRIBUTED)).toMatchObject({
				deletes: 0,
				deletion: { pending: 1, pendingReasons: { [code]: 1 } },
			});
		});
	}

	it("metadata (intent) write failure ⇒ not unlinked, not marked deleted", () => {
		const cwd = tempCwd();
		const a = recall(cwd, "g");
		evidenceDeleteFs.append = () => {
			throw new Error("EIO");
		};
		observeRecallRecheck("g", true);
		expect(lookupEvidence(a.absolutePath)).toBe("present");
		expect(recordOf(1)).toMatchObject({ status: "delete_pending", deleteReason: "metadata-write-failed" });
	});
});

describe("spec 118 D2 path safety (G5)", () => {
	it("swapped file (new inode) ⇒ 0 deletes", () => {
		const cwd = tempCwd();
		const a = recall(cwd, "g");
		// Same size, new inode: written beside the original, then renamed over it.
		writeFileSync(`${a.absolutePath}.swap`, `${SECRET}\nF821\n`);
		renameSync(`${a.absolutePath}.swap`, a.absolutePath);
		observeRecallRecheck("g", true);
		expect(lookupEvidence(a.absolutePath)).toBe("present");
		expect(recordOf(1)?.deleteReason).toBe("swapped");
	});

	it("symlink in place of the file ⇒ 0 deletes; target untouched", () => {
		const cwd = tempCwd();
		const a = recall(cwd, "g");
		const target = join(cwd, "victim.txt");
		writeFileSync(target, "keep");
		rmSync(a.absolutePath);
		symlinkSync(target, a.absolutePath);
		observeRecallRecheck("g", true);
		expect(readFileSync(target, "utf8")).toBe("keep");
		expect(recordOf(1)?.deleteReason).toBe("symlink");
	});

	it("recall dir symlinked outside the workspace ⇒ 0 deletes; outside file untouched", () => {
		const cwd = tempCwd();
		const outside = tempCwd();
		mkdirSync(join(cwd, ".omk", "goals"), { recursive: true });
		symlinkSync(outside, join(cwd, ".omk", "goals", "recall"));
		recall(cwd, "g");
		observeRecallRecheck("g", true);
		expect(readdirSync(outside).filter((n) => n.endsWith(".log"))).toHaveLength(1);
		expect(recordOf(1)?.deleteReason).toBe("outside");
	});

	it("another session's artifact id is not found from this session", () => {
		const cwd = tempCwd();
		recall(cwd, "g");
		observeRecallBlockedExhausted("g");
		expect(deleteEvidenceArtifact("ev-999").reason).toBe("not-found");
	});
});

describe("spec 118 D2 lookup (G6) and no path text (G10)", () => {
	it("deleted artifact is reported as deleted_after_use; log and report hold sha256 only", () => {
		const cwd = tempCwd();
		const a = recall(cwd, "g");
		observeRecallRecheck("g", true);
		expect(lookupEvidence(a.absolutePath)).toBe("deleted_after_use");
		const serialized = JSON.stringify({
			log: readFileSync(evidenceDeletionLogPath(outputRecallDir(cwd), EVIDENCE_UNATTRIBUTED), "utf8"),
			report: evidenceLifecycleReport(EVIDENCE_UNATTRIBUTED),
			records: listEvidenceArtifacts(EVIDENCE_UNATTRIBUTED),
		});
		expect(serialized).not.toContain(SECRET);
		expect(serialized).not.toContain(cwd);
		expect(serialized).not.toContain(".log");
	});
});

describe("spec 118 D2 counter (G8, G12)", () => {
	it("G8: delete all files of (goal, round, rev), restart ⇒ next attempt is larger, no reuse", () => {
		const cwd = tempCwd();
		const first = recall(cwd, "g");
		const second = recall(cwd, "g");
		observeRecallRecheck("g", true);
		expect(lookupEvidence(second.absolutePath)).toBe("deleted_after_use");
		resetEvidenceLifecycleForTest();
		const third = recall(cwd, "g");
		const attempt = (path: string) => Number(/-(\d+)-[0-9a-f]{8}\.log$/u.exec(path)?.[1]);
		expect(attempt(first.absolutePath)).toBe(1);
		expect(attempt(second.absolutePath)).toBe(2);
		expect(attempt(third.absolutePath)).toBe(3);
	});

	it("G12: crash between tmp write and rename leaves the sidecar whole (old content)", () => {
		const cwd = tempCwd();
		recall(cwd, "g");
		const sidecar = join(outputRecallDir(cwd), RECALL_COUNTER_FILE);
		const before = readFileSync(sidecar, "utf8");
		recallCounterFs.rename = () => {
			throw new Error("crash");
		};
		recall(cwd, "g");
		expect(readFileSync(sidecar, "utf8")).toBe(before);
		expect(JSON.parse(before)).toEqual({ v: 1, last: { "acceptance-g-0-1": 1 } });
		expect(readdirSync(outputRecallDir(cwd)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
	});

	it("G12: corrupt sidecar ⇒ capture continues, 0 deletes in that folder, reason counter-corrupt", () => {
		const cwd = tempCwd();
		recall(cwd, "g");
		writeFileSync(join(outputRecallDir(cwd), RECALL_COUNTER_FILE), "{not json");
		const a = recall(cwd, "g");
		observeRecallRecheck("g", true);
		expect(lookupEvidence(a.absolutePath)).toBe("present");
		expect(deleteEvidenceArtifact("ev-2").reason).toBe("counter-corrupt");
		expect(listEvidenceArtifacts(EVIDENCE_UNATTRIBUTED).every((r) => r.status === "present")).toBe(true);
		expect(readFileSync(join(outputRecallDir(cwd), RECALL_COUNTER_FILE), "utf8")).toBe("{not json");
	});
});

describe("spec 118 D2 hold-aware pruners (G9, G13)", () => {
	it("G13: held artifacts survive the per-goal count cap; heldBytes equals their bytes", () => {
		const cwd = tempCwd();
		const files = [];
		for (let i = 0; i < OUTPUT_RECALL_PER_GOAL + 2; i++) {
			files.push(recall(cwd, "g", 0, `${SECRET}-${i}\n`.repeat(i + 1)));
			utimesSync(files[i].absolutePath, 1000 + i, 1000 + i);
		}
		const left = readdirSync(outputRecallDir(cwd)).filter((n) => n.endsWith(".log"));
		expect(left).toHaveLength(OUTPUT_RECALL_PER_GOAL + 2);
		const report = evidenceLifecycleReport(EVIDENCE_UNATTRIBUTED);
		// Only the two over the cap were kept because of the hold.
		const heldBytes = files[0].bytes + files[1].bytes;
		expect(report.deletion).toMatchObject({ heldCount: 2, heldBytes });
		expect(report.deletion?.heldReasons["goal-active"]).toBe(2);
	});

	it("G9: goal clear/replace skips an artifact under an active reader lease", () => {
		const cwd = tempCwd();
		const a = recall(cwd, "g");
		observeRecallBlockedExhausted("g");
		const release = acquireEvidenceLease(a.absolutePath);
		deleteGoalRecallFiles(cwd, "g");
		expect(lookupEvidence(a.absolutePath)).toBe("present");
		release();
	});

	it("unheld artifacts are still pruned by the count cap", () => {
		const cwd = tempCwd();
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe");
		for (let i = 0; i < OUTPUT_RECALL_PER_GOAL + 2; i++) recall(cwd, "g", i);
		expect(readdirSync(outputRecallDir(cwd)).filter((n) => n.endsWith(".log"))).toHaveLength(OUTPUT_RECALL_PER_GOAL);
	});
});

describe("spec 118 G5 cross-session id", () => {
	it("an id registered by another session deletes 0 files from this session", () => {
		resetEvidenceScopeForTest();
		const cwd = tempCwd();
		const a = withEvidenceSession("session-a", () => {
			const artifact = recall(cwd, "ga");
			// a's artifact is fully eligible inside a: ACKed, verified, no hold.
			updateEvidenceArtifact(artifact.absolutePath, {
				consumed: ["repair-turn", "acceptance-recheck"],
				verified: true,
				goalActive: false,
			});
			return artifact;
		});
		const aId = listEvidenceArtifacts("session-a")[0]?.artifactId as string;
		expect(aId).toBe("ev-1");
		const b = withEvidenceSession("session-b", () => {
			const own = recall(cwd, "gb"); // b's own ev-1, still held
			expect(deleteEvidenceArtifact(aId)).toEqual({ deleted: false, reason: "hold-goal-active" });
			observeRecallRecheck("ga", true); // b has no "ga" artifacts: nothing of a's is touched
			return own;
		});
		expect(lookupEvidence(a.absolutePath)).toBe("present");
		expect(lookupEvidence(b.absolutePath)).toBe("present");
		expect(withEvidenceSession("session-c", () => deleteEvidenceArtifact(aId))).toEqual({
			deleted: false,
			reason: "not-found",
		});
		expect(readdirSync(outputRecallDir(cwd)).filter((n) => n.endsWith(".log"))).toHaveLength(2);
		expect(readdirSync(outputRecallDir(cwd)).some((n) => n.startsWith("evidence-deletions-"))).toBe(false);
		resetEvidenceScopeForTest();
	});
});

describe("spec 118 EV9 links and restart lookup", () => {
	it("after a restart the deletion log still reports deleted_after_use", () => {
		const cwd = tempCwd();
		const a = recall(cwd, "g");
		observeRecallRecheck("g", true);
		resetEvidenceLifecycleForTest();
		expect(lookupEvidence(a.absolutePath)).toBe("deleted_after_use");
		rmSync(recall(cwd, "h").absolutePath);
		expect(lookupEvidence(join(outputRecallDir(cwd), "acceptance-h-0-1-9-00000000.log"))).toBe(
			"missing_unexpectedly",
		);
	});

	it("rewrites deleted and missing links, keeps present ones and non-recall lines", () => {
		const cwd = tempCwd();
		const deleted = recall(cwd, "g");
		observeRecallRecheck("g", true);
		const present = recall(cwd, "p");
		const line = (path: string) => `Full output: ${path} (2 lines, 31B; complete)`;
		const text = [
			"head",
			line(deleted.displayPath),
			line(present.displayPath),
			line(".omk/goals/recall/acceptance-x-0-1-1-00000000.log"),
			line("src/other.log"),
		].join("\n");
		expect(rewriteRecallLinks(text, cwd).split("\n")).toEqual([
			"head",
			DELETED_RECALL_LINK,
			line(present.displayPath),
			MISSING_RECALL_LINK,
			line("src/other.log"),
		]);
		const messages = [
			{ role: "user" as const, content: line(deleted.displayPath), timestamp: 0 },
			{ role: "user" as const, content: [{ type: "text" as const, text: line(present.displayPath) }], timestamp: 0 },
		];
		const next = rewriteRecallLinksInMessages(messages, cwd);
		expect(next?.[0]).toMatchObject({ content: DELETED_RECALL_LINK });
		expect(next?.[1]).toBe(messages[1]);
		expect(rewriteRecallLinksInMessages([messages[1]], cwd)).toBeUndefined();
	});
});
