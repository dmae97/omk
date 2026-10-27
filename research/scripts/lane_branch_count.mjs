#!/usr/bin/env node
// Usage: node lane_branch_count.mjs results.json runlog.jsonl...
// runlog arg may be "taskId=path" (per-trial log dir) or records may carry taskId.
// Qualify: a task with >=1 run whose lane plan had >=2 independent branches:
//   maxBatchLanes>=2 OR dependencyRoots>=2 (main logs `maxBatchLanes` and `dependencyRoots` since #261; older logs have only `lanes`).
// Records with only `lanes` are "unknownShape" (never counted as qualifying).
// Output keys are sha256(taskId)[:12]; no ids/paths printed.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
// Bench summary.json may contain bare NaN/Infinity (invalid JSON). Replace those tokens with null
// only outside strings; non-finite numeric fields are then skipped and counted in skippedNonNumeric.
export function tolerantParse(text) {
  let out = "", i = 0, inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) { out += c; if (c === "\\") { out += text[i + 1] ?? ""; i += 2; continue; } if (c === '"') inStr = false; i++; continue; }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    const m = /^(-?Infinity|NaN)(?![A-Za-z0-9_$])/.exec(text.slice(i, i + 10));
    if (m && !/[A-Za-z0-9_$]/.test(text[i - 1] ?? "")) { out += "null"; i += m[0].length; continue; }
    out += c; i++;
  }
  return JSON.parse(out);
}
let skippedNonNumeric = 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const present = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const h = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 12);
const [resultsPath, ...logs] = process.argv.slice(2);
if (!resultsPath) { console.error("usage: lane_branch_count.mjs results.json runlog.jsonl..."); process.exit(2); }
const res = tolerantParse(readFileSync(resultsPath, "utf8"));
const trials = Array.isArray(res) ? res : res.trials ?? res.results ?? [];
const tasks = {};
for (const t of trials) { const id = t.taskId ?? t.task_id ?? t.task; if (id != null) tasks[h(id)] ??= { trials: 0, branchedRuns: 0, unknownShape: 0 }; if (id != null) tasks[h(id)].trials++; }
let unmatchedLines = 0, laneLines = 0;
for (const arg of logs) {
  const eq = arg.indexOf("="); const fileTask = eq > 0 ? arg.slice(0, eq) : null; const p = eq > 0 ? arg.slice(eq + 1) : arg;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue; let r; try { r = tolerantParse(line); } catch { continue; }
    if (!r || typeof r !== "object") continue;
    for (const f of ["lanes", "maxBatchLanes", "dependencyRoots"]) if (present(r, f) && !isNum(r[f])) { skippedNonNumeric++; delete r[f]; }
    if (!isNum(r.lanes)) continue; laneLines++;
    const id = r.taskId ?? fileTask; const k = id == null ? null : h(id);
    if (!k || !tasks[k]) { unmatchedLines++; continue; }
    const w = r.maxBatchLanes, roots = r.dependencyRoots;
    if (!isNum(w) && !isNum(roots)) { tasks[k].unknownShape++; continue; }
    if ((w ?? 0) >= 2 || (roots ?? 0) >= 2) tasks[k].branchedRuns++;
  }
}
const ids = Object.keys(tasks);
const qualifying = ids.filter((k) => tasks[k].branchedRuns > 0).length;
console.log(JSON.stringify({ tasksSeen: ids.length, qualifying, runAB: qualifying >= 3, laneLines, unmatchedLines, skippedNonNumeric,
  unknownShapeTasks: ids.filter((k) => tasks[k].unknownShape > 0 && !tasks[k].branchedRuns).length, tasks }, null, 1));
