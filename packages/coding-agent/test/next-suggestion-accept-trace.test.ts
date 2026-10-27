/** Next-suggestion accept trace (`OMK_NEXT_SUGGESTIONS_ACCEPT_TRACE`, default off). */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	dismissReasonForKey,
	EDIT_RATIO_BUCKETS,
	editDistance,
	editRatioBucket,
	isAcceptTraceEnabled,
	MAX_FILE_BYTES,
	resetSaltInvalidReportForTests,
	SESSION_SALT_FILE,
	type ShownSuggestionMeta,
	SuggestionAcceptTracker,
	type SuggestionOutcomeRecord,
	sessionHash,
	suggestionAcceptTracker,
} from "../src/core/next-suggestion-accept-trace.ts";
import { runAcceptScenario, SENT, SUGGESTION } from "./fixtures/accept-trace/scenario.ts";

const SUGGEST_ON = { OMK_NEXT_SUGGESTIONS: "1" };
const TRACE_ON = { ...SUGGEST_ON, OMK_NEXT_SUGGESTIONS_ACCEPT_TRACE: "1" };
const T0 = 1_800_000_000_000;
const ALLOWED_KEYS = new Set([
	"schemaVersion",
	"sessionHash",
	"parentTurnIndex",
	"provider",
	"model",
	"settledAtEpochMs",
	"quotaCheckedAtEpochMs",
	"shownAtEpochMs",
	"outcome",
	"decidedAtEpochMs",
	"msToAccept",
	"sentAs",
	"sentVia",
	"editRatioBucket",
	"dismissReason",
]);

const SESSION_ID = "raw-session-id-7f3a9c";
let home: string;
beforeEach(() => {
	// Temp HOME: the salt lands under <HOME>/.omk/agent, never the real one.
	home = mkdtempSync(join(tmpdir(), "omk-accept-home-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("OMK_CODING_AGENT_DIR", "");
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

function fakeDate() {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(T0);
}

const meta: ShownSuggestionMeta = {
	parentTurnIndex: 0,
	provider: "anthropic",
	model: "m",
	settledAtEpochMs: 10,
	quotaCheckedAtEpochMs: 12,
	shownAtEpochMs: 40,
};

function tracker() {
	const records: Array<Omit<SuggestionOutcomeRecord, "schemaVersion" | "sessionHash">> = [];
	return { t: new SuggestionAcceptTracker((r) => records.push(r)), records };
}

function parse(jsonl: string | undefined): SuggestionOutcomeRecord[] {
	return (jsonl ?? "")
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l) as SuggestionOutcomeRecord);
}

describe("accept trace: tracker state machine", () => {
	it("flag parsing is default off", () => {
		expect(isAcceptTraceEnabled({})).toBe(false);
		expect(isAcceptTraceEnabled({ OMK_NEXT_SUGGESTIONS_ACCEPT_TRACE: "0" })).toBe(false);
		expect(isAcceptTraceEnabled({ OMK_NEXT_SUGGESTIONS_ACCEPT_TRACE: "on" })).toBe(true);
		expect(suggestionAcceptTracker(() => "s", "/nonexistent", SUGGEST_ON)).toBeUndefined();
		expect(
			suggestionAcceptTracker(() => "s", "/nonexistent", { ...TRACE_ON, OMK_TURN_METRICS: "off" }),
		).toBeUndefined();
	});

	it("Tab then exact send ⇒ one accepted record with msToAccept", () => {
		const { t, records } = tracker();
		t.shown(meta, "run tests");
		t.accepted(100);
		t.observeEditor("run tests", 110);
		t.sent("run tests", 120);
		t.sent("run tests", 130); // a later send is not double counted
		t.flush(140);
		expect(records).toEqual([
			{
				...meta,
				outcome: "accepted",
				msToAccept: 60,
				sentAs: "exact",
				editRatioBucket: "0",
				sentVia: "prompt",
				decidedAtEpochMs: 120,
			},
		]);
	});

	it("edited send carries a bucket; emptied editor is cleared; never-sent accept is abandoned; one record each", () => {
		const { t, records } = tracker();
		t.shown(meta, "run the parser tests");
		t.accepted(50);
		t.sent("run the parser tests now", 60);
		t.shown(meta, "abc");
		t.accepted(70);
		t.observeEditor("", 80);
		t.sent("something else", 90);
		t.shown(meta, "unsent");
		t.accepted(95);
		t.flush(99);
		expect(records.map((r) => [r.outcome, r.sentAs, r.editRatioBucket, r.sentVia])).toEqual([
			["accepted", "edited", "le_0.3", "prompt"],
			["accepted", "cleared", undefined, undefined],
			["accepted", "abandoned", undefined, undefined],
		]);
	});

	it("cleared only when the editor is emptied; replaced or never-sent suggestions are abandoned", () => {
		const { t, records } = tracker();
		t.shown(meta, "a"); // shown, no input, replaced by the next suggestion
		t.shown(meta, "b");
		t.accepted(1); // accepted, then replaced by another suggestion before sending
		t.observeEditor("b", 2);
		t.shown(meta, "c");
		t.flush(3); // shown, session ended with no input
		expect(records.map((r) => [r.outcome, r.sentAs ?? r.dismissReason])).toEqual([
			["dismissed", "abandoned"],
			["accepted", "abandoned"],
			["dismissed", "abandoned"],
		]);
		expect(records.some((r) => r.sentAs === "cleared")).toBe(false);
	});

	it("sentVia: prompt vs steer on sent outcomes only", () => {
		const { t, records } = tracker();
		t.shown(meta, "run tests");
		t.accepted(1);
		t.sent("run tests", 2, "steer");
		t.shown(meta, "fix it");
		t.accepted(3);
		t.sent("fix it please", 4, "prompt");
		t.shown(meta, "x");
		t.accepted(5);
		t.observeEditor("", 6);
		expect(records.map((r) => [r.sentAs, r.sentVia])).toEqual([
			["exact", "steer"],
			["edited", "prompt"],
			["cleared", undefined],
		]);
	});

	it("10 MB cap: exactly one cap_reached record, then nothing more (also after a restart)", () => {
		const dir = join(home, "agent");
		const metricsDir = join(home, "m");
		mkdirSync(metricsDir, { recursive: true });
		const file = join(metricsDir, "suggestion-outcomes.jsonl");
		writeFileSync(file, Buffer.alloc(MAX_FILE_BYTES - 10, 0x20));
		const make = () =>
			suggestionAcceptTracker(() => "s", "/nonexistent", { ...TRACE_ON, OMK_TURN_METRICS_DIR: metricsDir }, dir)!;
		for (const t of [make(), make()]) {
			for (let i = 0; i < 3; i++) {
				t.shown(meta, "x");
				t.flush(7);
			}
		}
		const tail = readFileSync(file)
			.subarray(MAX_FILE_BYTES - 10)
			.toString("utf8");
		const records = parse(tail);
		expect(records).toEqual([
			{ schemaVersion: "omk-suggestion-outcome-1", outcome: "cap_reached", decidedAtEpochMs: 7 },
		]);
	});

	it("salt not 32 bytes: one salt_invalid marker per process, no records, no salt or raw id", () => {
		resetSaltInvalidReportForTests();
		const dir = join(home, "agent");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, SESSION_SALT_FILE), "short-salt-SECRET");
		const make = () =>
			suggestionAcceptTracker(() => SESSION_ID, "/nonexistent", { ...TRACE_ON, OMK_TURN_METRICS_DIR: home }, dir)!;
		for (const t of [make(), make()]) {
			t.shown(meta, "x");
			t.flush(9);
			t.shown(meta, "y");
			t.flush(10);
		}
		const raw = readFileSync(join(home, "suggestion-outcomes.jsonl"), "utf8");
		expect(parse(raw)).toEqual([
			{ schemaVersion: "omk-suggestion-outcome-1", outcome: "salt_invalid", decidedAtEpochMs: 9 },
		]);
		expect(raw).not.toContain("SECRET");
		expect(raw).not.toContain(SESSION_ID);
		// A 33-byte salt is also rejected (no silent truncation).
		resetSaltInvalidReportForTests();
		writeFileSync(join(dir, SESSION_SALT_FILE), Buffer.alloc(33, 1));
		const t = make();
		t.shown(meta, "z");
		t.flush(11);
		expect(parse(readFileSync(join(home, "suggestion-outcomes.jsonl"), "utf8")).map((r) => r.outcome)).toEqual([
			"salt_invalid",
			"salt_invalid",
		]);
	});

	it("dismiss reasons: typed_over, new_turn, other; accepted suggestions are never dismissed", () => {
		const { t, records } = tracker();
		t.shown(meta, "a");
		t.dismissed(dismissReasonForKey("x"), 1);
		t.shown(meta, "b");
		t.sent("next prompt", 2);
		t.shown(meta, "c");
		t.dismissed(dismissReasonForKey("\x1b[A"), 3);
		t.shown(meta, "d");
		t.accepted(4);
		t.dismissed("new_turn", 5);
		t.sent("d", 6);
		expect(records.map((r) => r.dismissReason ?? r.sentAs)).toEqual(["typed_over", "new_turn", "other", "exact"]);
	});

	it("salt is created once per install and reused; hash is sha256(salt + id) truncated to 16 hex", () => {
		const dir = join(home, "agent");
		const write = (id: string) => {
			const t = suggestionAcceptTracker(() => id, "/nonexistent", { ...TRACE_ON, OMK_TURN_METRICS_DIR: home }, dir)!;
			t.shown(meta, "x");
			t.flush(1);
		};
		write("a");
		const salt = readFileSync(join(dir, SESSION_SALT_FILE));
		write("b");
		expect(readFileSync(join(dir, SESSION_SALT_FILE)).equals(salt)).toBe(true);
		const lines = parse(readFileSync(join(home, "suggestion-outcomes.jsonl"), "utf8"));
		expect(lines.map((r) => r.sessionHash)).toEqual([sessionHash(salt, "a"), sessionHash(salt, "b")]);
		expect(sessionHash(salt, "a")).not.toBe(sessionHash(Buffer.alloc(32), "a"));
	});

	it("edit distance and buckets", () => {
		expect(editDistance("kitten", "sitting")).toBe(3);
		expect(editRatioBucket("abc", "abc")).toBe("0");
		expect(editRatioBucket("abcdefghij", "abcdefghiX")).toBe("le_0.1");
		expect(editRatioBucket("abc", "xyz")).toBe("gt_0.6");
		expect(EDIT_RATIO_BUCKETS).toHaveLength(5);
	});
});

describe("accept trace: controller wiring", () => {
	it("golden (required): trace flag off ⇒ turns, files, editor and main requests byte-identical to main 7cd26ee5fa", async () => {
		const golden = JSON.parse(
			readFileSync(join(import.meta.dirname, "fixtures", "accept-trace", "flag-off-golden.json"), "utf8"),
		);
		fakeDate();
		const off = await runAcceptScenario(SUGGEST_ON, (dir) => ({
			acceptTrace: suggestionAcceptTracker(() => SESSION_ID, "/nonexistent", {
				...SUGGEST_ON,
				OMK_TURN_METRICS_DIR: dir,
			}),
		}));
		expect(JSON.stringify(off, null, "\t")).toBe(JSON.stringify(golden, null, "\t"));
		expect(off.outcomes).toBeUndefined();
	});

	it("trace on: same turns/editor/main requests as off, plus exactly one record per shown suggestion, 0 bytes of text", async () => {
		const golden = JSON.parse(
			readFileSync(join(import.meta.dirname, "fixtures", "accept-trace", "flag-off-golden.json"), "utf8"),
		);
		fakeDate();
		const on = await runAcceptScenario(SUGGEST_ON, (dir) => ({
			acceptTrace: suggestionAcceptTracker(() => SESSION_ID, "/nonexistent", {
				...TRACE_ON,
				OMK_TURN_METRICS_DIR: dir,
			}),
		}));
		expect(on.turns).toBe(golden.turns);
		expect(on.editor).toEqual(golden.editor);
		expect(on.mainRequests).toEqual(golden.mainRequests);
		const records = parse(on.outcomes);
		// Two shown suggestions ⇒ two records: the Tab accept (edited) and the typed-over dismissal.
		expect(records.map((r) => [r.outcome, r.sentAs ?? r.dismissReason])).toEqual([
			["accepted", "edited"],
			["dismissed", "typed_over"],
		]);
		expect(records.filter((r) => r.outcome === "accepted")).toHaveLength(1);
		expect(records[0]).toMatchObject({ msToAccept: 0, editRatioBucket: "le_0.1", shownAtEpochMs: T0 });
		for (const r of records) {
			for (const k of Object.keys(r)) expect(ALLOWED_KEYS.has(k), k).toBe(true);
			expect(r.settledAtEpochMs <= r.quotaCheckedAtEpochMs && r.quotaCheckedAtEpochMs <= r.shownAtEpochMs).toBe(
				true,
			);
		}
		// Salted session hash: per-install 32-byte 0600 salt; raw session id never written.
		const saltFile = join(home, ".omk", "agent", SESSION_SALT_FILE);
		const salt = readFileSync(saltFile);
		expect(salt).toHaveLength(32);
		expect(statSync(saltFile).mode & 0o777).toBe(0o600);
		for (const r of records) expect(r.sessionHash).toBe(sessionHash(salt, SESSION_ID));
		expect(records[0]!.sessionHash).toMatch(/^[0-9a-f]{16}$/);
		expect(on.outcomes).not.toContain(SESSION_ID);
		expect(on.outcomes).not.toContain(salt.toString("hex"));
		// No suggestion or prompt text, nor any fragment of it.
		for (const secret of [SUGGESTION, SENT, "SECRET", "parser", "first"]) expect(on.outcomes).not.toContain(secret);
	});
});
