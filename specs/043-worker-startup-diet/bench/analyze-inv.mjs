// usage: node analyze-inv.mjs <trace.tsv> [mockLog.jsonl] -> grouped counts
import { readFileSync } from "node:fs";
const [file, mockLog] = process.argv.slice(2);
const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => { const [t, f, u] = l.split("\t"); return { t: +t, f, u }; });
let arrive = Infinity;
if (mockLog) { const ls = readFileSync(mockLog, "utf8").trim().split("\n").map(JSON.parse); arrive = ls[ls.length - 1].arrive; }
const nonBuiltin = rows.filter((r) => r.f !== "builtin");
const group = (u) => {
	const p = u.replace(/^file:\/\//, "");
	let m = p.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/g);
	if (m) return "npm:" + m[m.length - 1].replace("node_modules/", "");
	m = p.match(/packages\/([^/]+)\/dist\/(.*)$/);
	if (m) { const parts = m[2].split("/"); const dir = parts.length > 1 ? parts.slice(0, Math.min(parts.length - 1, m[1] === "coding-agent" ? 3 : 1)).join("/") : "(root)"; return `${m[1]}:${dir}`; }
	return "other:" + p;
};
const g = new Map();
for (const r of nonBuiltin) { const k = group(r.u); const e = g.get(k) || { n: 0, before: 0 }; e.n++; if (r.t < arrive) e.before++; g.set(k, e); }
const before = nonBuiltin.filter((r) => r.t < arrive).length;
console.log(`total loaded (incl builtin): ${rows.length}; non-builtin: ${nonBuiltin.length}; non-builtin before 1st request: ${mockLog ? before : "n/a"}; builtin: ${rows.length - nonBuiltin.length}`);
const pk = new Map();
for (const [k, v] of g) { const top = k.startsWith("npm:") ? k : k.split(":")[0] + ":" + k.split(":")[1].split("/")[0]; const e = pk.get(top) || { n: 0, before: 0 }; e.n += v.n; e.before += v.before; pk.set(top, e); }
console.log("\n## by package / top dir (count, before-1st-request)");
for (const [k, v] of [...pk].sort((a, b) => b[1].n - a[1].n)) console.log(`${String(v.n).padStart(5)} ${String(v.before).padStart(5)}  ${k}`);
console.log("\n## by dir (detail)");
for (const [k, v] of [...g].sort((a, b) => b[1].n - a[1].n)) console.log(`${String(v.n).padStart(5)} ${String(v.before).padStart(5)}  ${k}`);
