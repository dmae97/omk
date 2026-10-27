import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const f = (n) => new URL(`./fixtures/${n}`, import.meta.url).pathname;
const run = (s, a) => JSON.parse(execFileSync("node", [new URL(`../scripts/${s}`, import.meta.url).pathname, ...a], { encoding: "utf8" }));
const g = run("skill_autoload_g1g2.mjs", ["t1", "t2", "t3", "t4", "t5", "t6", "on1", "on2"].map((t) => `${t}=${f(t + ".jsonl")}`));
assert.equal(g.G1.qualifyingTasks, 3); assert.equal(g.G1.pass, true); assert.equal(g.badLines, 1);
assert.deepEqual(g.requestTokensBefore, { known: 1, unknown: 7 });
assert.equal(g.G2.treatment.num, 1); assert.equal(g.G2.treatment.den, 3); assert.equal(g.G2.treatment.clusters, 2);
assert.equal(g.G2.flagOffPreview.den, 5); assert.equal(g.G2.flagOffPreview.num, 4); // t5 read before prompt => unused
const o = run("outcome_unknown_count.mjs", [f("sessA.jsonl"), f("sessB.jsonl")]);
assert.equal(o.total.calls, 8); assert.equal(o.total.timeout, 2); assert.equal(o.total.aborted, 3);
assert.equal(o.total.envelope, 2); assert.equal(o.total.toolText, 3); assert.equal(o.tasksWithOutcomeUnknown, 2);
assert.deepEqual(o.total.byTool, { bash: 2, edit: 1, write: 2 });
const l = run("lane_branch_count.mjs", [f("lane_summary_nan.json"), `ta=${f("lane_ta.jsonl")}`, `tb=${f("lane_tb.jsonl")}`]);
assert.equal(l.tasksSeen, 3); assert.equal(l.qualifying, 1); assert.equal(l.laneLines, 3);
assert.equal(l.skippedNonNumeric, 3); assert.equal(l.unknownShapeTasks, 1);
const out = JSON.stringify(g) + JSON.stringify(o) + JSON.stringify(l);
assert.ok(!/fixtures|\/fake|"sa"|"s1"/.test(out), "no paths/ids leaked");
console.log("all ok");
