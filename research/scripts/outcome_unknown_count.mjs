#!/usr/bin/env node
// Spec 119 AU4 pre-count: bash/edit/write tool calls that ended in abort or timeout. 0 deps, no network.
// Usage: node outcome_unknown_count.mjs [taskId=]session.jsonl ...
// Session JSONL (session-manager.ts): {type:"session",id,...} header + {type:"message",message:{role:"toolResult",
//   toolName,isError,content,details}} (ai/src/types.ts:332-340; agent-loop.ts:1589-1598).
// Classification, in order:
//   1. details.omk.disposition (tool-result/v2 envelope, agent/src/types.ts:561,629; stamped by
//      tool-execution-boundary.ts:251) == "aborted" | "timeout"  -> source "envelope"
//      (boundary timeout :79, parent abort :108, terminal :216-227, pre-exec abort agent-loop.ts:1037).
//   2. isError and envelope "failed"/absent but last text line is a tool-thrown marker -> source "toolText":
//      bash "Command aborted" (bash.ts:239), "Command timed out after N seconds" (bash.ts:250, remaining-budget.ts:192-194),
//      edit/write "Operation aborted" (edit.ts:171,235; write.ts:97,128).
// Output: counts per sha256(task)[:12] and totals; no paths, ids or text.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const h = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 12);
const TOOLS = new Set(["bash", "edit", "write"]);
const args = process.argv.slice(2);
if (!args.length) { console.error("usage: outcome_unknown_count.mjs [taskId=]session.jsonl..."); process.exit(2); }
const lastLine = (msg) => { const t = (msg.content ?? []).filter((b) => b?.type === "text").map((b) => b.text).join("").trimEnd(); return t.slice(t.lastIndexOf("\n") + 1).trim(); };
function classify(m) {
  const d = m.details?.omk?.disposition;
  if (d === "aborted" || d === "timeout") return [d, "envelope"];
  if (!m.isError || (d !== undefined && d !== "failed")) return null;
  const l = lastLine(m);
  if (l === "Command aborted" || l === "Operation aborted") return ["aborted", "toolText"];
  if (/^Command timed out after \d+ seconds/.test(l)) return ["timeout", "toolText"];
  return null;
}
const tasks = {}; let badLines = 0, files = 0;
const zero = () => ({ calls: 0, aborted: 0, timeout: 0, byTool: { bash: 0, edit: 0, write: 0 }, envelope: 0, toolText: 0 });
for (const arg of args) {
  const eq = arg.indexOf("="); let task = eq > 0 ? arg.slice(0, eq) : null; const p = eq > 0 ? arg.slice(eq + 1) : arg; files++;
  const lines = readFileSync(p, "utf8").split("\n"); const recs = [];
  for (const line of lines) { if (!line.trim()) continue; try { recs.push(JSON.parse(line)); } catch { badLines++; } }
  task ??= recs.find((r) => r.type === "session")?.id ?? `file:${h(p)}`;
  const t = (tasks[h(task)] ??= zero());
  for (const r of recs) {
    const m = r.type === "message" ? r.message : null;
    if (m?.role !== "toolResult" || !TOOLS.has(m.toolName)) continue;
    t.calls++; const c = classify(m); if (!c) continue;
    t[c[0]]++; t.byTool[m.toolName]++; t[c[1]]++;
  }
}
const ids = Object.keys(tasks), total = zero();
for (const k of ids) { const t = tasks[k]; for (const f of ["calls", "aborted", "timeout", "envelope", "toolText"]) total[f] += t[f]; for (const n of TOOLS) total.byTool[n] += t.byTool[n]; }
console.log(JSON.stringify({ files, tasksSeen: ids.length, badLines, tasksWithOutcomeUnknown: ids.filter((k) => tasks[k].aborted + tasks[k].timeout > 0).length,
  total: { ...total, outcomeUnknown: total.aborted + total.timeout }, tasks }, null, 1));
