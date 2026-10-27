#!/usr/bin/env node
// Spec 117 G1/G2 counter for skill-autoload.jsonl. 0 deps, no network.
// Usage: node skill_autoload_g1g2.mjs [taskId=]skill-autoload.jsonl ...
// Schema (main fc3fee6b46):
//   prompt: skill-auto-load.ts:163-176 {kind:"prompt",sessionId,parentSessionId,seq,requestTokensBefore,alreadyAdmitted,
//           admittedTotal,flags:{autoLoad,admission},candidates:[{nameSha256,digest,pathHash,band,wouldLoad,loaded,...}]}
//   read:   skill-autoload-observe.ts:79 {kind:"read",sessionId,seq,nameSha256,turn} (called from skill-admission-session.ts:143)
// Task key: "taskId=" prefix, else parentSessionId ?? sessionId. Output keys are sha256(...)[:12]; no paths/ids/text.
// G1 (spec 117 §4): flag-off prompts; a task qualifies if >=1 candidate wouldLoad:true (strong band, score>=0.7)
//   has no read line with that nameSha256 in the same session. Pass if >=3 tasks.
// G2 (report-only): unused-load rate = loaded skills with no later read (seq > prompt seq) / loaded, pooled with a
//   task-clustered 95% CI (ratio estimator). Flag-off preview uses wouldLoad:true instead of loaded:true.
// requestTokensBefore null/missing => unknown, never 0.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const h = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 12);
const args = process.argv.slice(2);
if (!args.length) { console.error("usage: skill_autoload_g1g2.mjs [taskId=]skill-autoload.jsonl..."); process.exit(2); }
const prompts = [], reads = new Map(); // sessionKey -> Map(nameSha256 -> [seq])
let badLines = 0, otherLines = 0;
for (const arg of args) {
  const eq = arg.indexOf("="); const fileTask = eq > 0 ? arg.slice(0, eq) : null; const p = eq > 0 ? arg.slice(eq + 1) : arg;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue; let r; try { r = JSON.parse(line); } catch { badLines++; continue; }
    const sess = `${fileTask ?? ""}\u0000${r.sessionId ?? "null"}`;
    if (r.kind === "prompt" && Array.isArray(r.candidates)) prompts.push({ r, sess, task: fileTask ?? r.parentSessionId ?? r.sessionId ?? "null" });
    else if (r.kind === "read" && typeof r.nameSha256 === "string") {
      if (!reads.has(sess)) reads.set(sess, new Map()); const m = reads.get(sess);
      if (!m.has(r.nameSha256)) m.set(r.nameSha256, []); m.get(r.nameSha256).push(typeof r.seq === "number" ? r.seq : Infinity);
    } else otherLines++;
  }
}
const readSeqs = (sess, n) => reads.get(sess)?.get(n) ?? [];
const tasks = {};
const T = (k) => (tasks[k] ??= { prompts: 0, flagOffPrompts: 0, strongCands: 0, wouldLoad: 0, wouldLoadNeverRead: 0,
  loaded: 0, loadedUnused: 0, previewUnused: 0, tokensKnown: 0, tokensUnknown: 0 });
for (const { r, sess, task } of prompts) {
  const t = T(h(task)); t.prompts++;
  if (typeof r.requestTokensBefore === "number" && Number.isFinite(r.requestTokensBefore)) t.tokensKnown++; else t.tokensUnknown++;
  const flagOff = r.flags?.autoLoad !== true; if (flagOff) t.flagOffPrompts++;
  for (const c of r.candidates) {
    if (c.band === "strong") t.strongCands++;
    const seqs = readSeqs(sess, c.nameSha256);
    const usedAfter = seqs.some((s) => typeof r.seq !== "number" || s > r.seq);
    if (flagOff && c.wouldLoad === true) { t.wouldLoad++; if (!seqs.length) t.wouldLoadNeverRead++; if (!usedAfter) t.previewUnused++; }
    if (c.loaded === true) { t.loaded++; if (!usedAfter) t.loadedUnused++; }
  }
}
const ids = Object.keys(tasks);
function clustered(numKey, denKey) {
  const rows = ids.map((k) => [tasks[k][numKey], tasks[k][denKey]]).filter(([, d]) => d > 0);
  const N = rows.reduce((a, [, d]) => a + d, 0); if (!N) return { num: 0, den: 0, rate: null, ci95: null, clusters: 0 };
  const U = rows.reduce((a, [u]) => a + u, 0), rate = U / N, k = rows.length;
  if (k < 2) return { num: U, den: N, rate, ci95: null, clusters: k };
  const v = (k / (k - 1)) * rows.reduce((a, [u, d]) => a + (u - rate * d) ** 2, 0) / N ** 2, se = Math.sqrt(v);
  return { num: U, den: N, rate, ci95: [Math.max(0, rate - 1.96 * se), Math.min(1, rate + 1.96 * se)], clusters: k };
}
const g1Tasks = ids.filter((k) => tasks[k].wouldLoadNeverRead > 0).length;
const sum = (key) => ids.reduce((a, k) => a + tasks[k][key], 0);
console.log(JSON.stringify({
  tasksSeen: ids.length, promptLines: prompts.length, readLines: [...reads.values()].reduce((a, m) => a + [...m.values()].reduce((b, x) => b + x.length, 0), 0),
  badLines, otherLines,
  requestTokensBefore: { known: sum("tokensKnown"), unknown: sum("tokensUnknown") },
  G1: { flagOffPrompts: sum("flagOffPrompts"), qualifyingTasks: g1Tasks, pass: g1Tasks >= 3 },
  G2: { reportOnly: true, treatment: clustered("loadedUnused", "loaded"), flagOffPreview: clustered("previewUnused", "wouldLoad"),
    caveat: "used = later read line only; pathHash tool-call match not available in this log" },
  tasks,
}, null, 1));
