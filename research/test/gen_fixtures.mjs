// Generates synthetic fixtures (no real data). Hashes of fake names only.
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const s = (x) => createHash("sha256").update(x).digest("hex");
const d = new URL("./fixtures/", import.meta.url); mkdirSync(d, { recursive: true });
const P = (sessionId, seq, cands, extra = {}) => JSON.stringify({ kind: "prompt", sessionId, parentSessionId: null, seq, requestTokensBefore: null, alreadyAdmitted: 0, admittedTotal: 0, flags: { autoLoad: false, admission: false }, candidates: cands, ...extra });
const C = (n, band, wouldLoad, loaded = false) => ({ nameSha256: s(n), digest: s(n + "d"), pathHash: s("/x/" + n), band, wouldLoad, loaded, capRefused: false, overBudget: false, bodyBytes: 100, bodyTokens: 25 });
const R = (sessionId, seq, n) => JSON.stringify({ kind: "read", sessionId, seq, nameSha256: s(n), turn: 1 });
// flag-off: G1 tasks = t1,t3,t6 (strong wouldLoad, no read in session); t2 read; t4 ambiguous only; t5 read before prompt (not G1, but G2-unused)
writeFileSync(new URL("t1.jsonl", d), [P("s1", 1, [C("A", "strong", true)]), R("s1", 2, "Z")].join("\n") + "\n");
writeFileSync(new URL("t2.jsonl", d), [P("s2", 1, [C("A", "strong", true)]), R("s2", 2, "A")].join("\n") + "\n");
writeFileSync(new URL("t3.jsonl", d), [P("s3", 1, [C("B", "strong", true), C("A", "ambiguous", false)]), "not json"].join("\n") + "\n");
writeFileSync(new URL("t4.jsonl", d), P("s4", 1, [C("C", "ambiguous", false)]) + "\n");
writeFileSync(new URL("t5.jsonl", d), [R("s5", 1, "D"), P("s5", 2, [C("D", "strong", true)], { requestTokensBefore: 0 })].join("\n") + "\n");
writeFileSync(new URL("t6.jsonl", d), P("s6", 1, [C("E", "strong", true)]) + "\n");
// flag-on treatment: 2 tasks, 3 loaded, 1 unused
const on = { flags: { autoLoad: true, admission: true } };
writeFileSync(new URL("on1.jsonl", d), [P("o1", 1, [C("A", "strong", true, true), C("B", "strong", true, true)], on), R("o1", 2, "A")].join("\n") + "\n");
writeFileSync(new URL("on2.jsonl", d), [P("o2", 1, [C("A", "strong", true, true)], on), R("o2", 2, "A")].join("\n") + "\n");
// sessions for outcome-unknown
const hdr = (id) => JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00Z", cwd: "/fake" });
const TR = (toolName, isError, text, disposition) => JSON.stringify({ type: "message", id: "x", parentId: null, timestamp: "t", message: { role: "toolResult", toolCallId: "c", toolName, content: [{ type: "text", text }], isError, timestamp: 0, ...(disposition ? { details: { omk: { schema: "tool-result/v2", synthetic: disposition !== "completed" && disposition !== "failed", disposition, executionStarted: true } } } : {}) } });
writeFileSync(new URL("sessA.jsonl", d), [hdr("sa"),
  TR("bash", true, "out\n\nCommand timed out after 30 seconds", "failed"),
  TR("bash", true, "Command aborted", "failed"),
  TR("edit", true, 'Tool "edit" timed out after 1000ms. Cancellation was requested; execution may still be running.', "timeout"),
  TR("write", true, "Operation aborted", "aborted"),
  TR("read", true, "Operation aborted", "aborted"),
  TR("bash", true, "exit 1\n\nCommand exited with code 1", "failed"),
  TR("bash", false, "Command aborted", "completed")].join("\n") + "\n");
writeFileSync(new URL("sessB.jsonl", d), [hdr("sb"), TR("write", true, "Operation aborted"), TR("edit", false, "ok", "completed")].join("\n") + "\n");
