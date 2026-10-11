// usage: node analyze-ab.mjs <rawDir>  -> preliminary A/B summary (base vs branch)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const D = process.argv[2];
const ws = readFileSync(join(D, "workers.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const mock = {};
for (const v of ["fast", "slow", "tool"]) { const f = join(D, `mock-${v}.jsonl`); if (existsSync(f)) for (const l of readFileSync(f, "utf8").trim().split("\n")) { const r = JSON.parse(l); (mock[r.tag] ??= []).push(r); } }
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return NaN; const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const rows = {};
for (const w of ws) {
	const m = w.tag.match(/^bench-(base|branch)-(fast|slow|tool)-r(\w+)-w0$/); if (!m) continue;
	const [, arm, v, rep] = m; if (rep === "w0") continue;
	const reqs = mock[w.tag]; if (!reqs) { console.log("no mock for", w.tag); continue; }
	const mk = reqs[0];
	const startup = mk.arrive - w.t0;
	const wall = w.tExit - w.t0;
	const toolOk = v !== "tool" || (reqs.length === 2 && reqs[0].turn === 1 && reqs[1].turn === 2 && reqs[0].hasReadTool);
	let idle = NaN;
	if (v === "slow") { const s = w.samples.filter((x) => x.t >= mk.arrive + 300 && x.t <= mk.respond - 200).map((x) => x.rss); idle = q(s, 0.5); }
	(rows[`${v}`] ??= {})[rep] ??= {};
	rows[v][rep][arm] = { startup, wall, idle, peak: w.time.maxRssMiB, cpu: (w.time.userS + w.time.sysS) * 1000, ok: w.stdoutHasOk && w.exit === 0 && toolOk };
}
const f1 = (x) => x.toFixed(1);
for (const v of ["fast", "slow", "tool"]) {
	if (!rows[v]) continue;
	const reps = Object.keys(rows[v] ?? {}).filter((r) => rows[v][r].base && rows[v][r].branch);
	console.log(`\n## ${v} mock: ${reps.length} pairs (ok: base ${reps.filter((r) => rows[v][r].base.ok).length}, branch ${reps.filter((r) => rows[v][r].branch.ok).length})`);
	const metrics = v === "fast" ? ["startup", "cpu", "peak"] : v === "slow" ? ["startup", "idle", "peak"] : ["wall", "cpu", "peak"];
	console.log("| metric | main med / p90 / IQR | branch med / p90 / IQR | paired diff med (branch−main) | pairs branch<main |");
	console.log("|---|---|---|---|---|");
	for (const k of metrics) {
		const a = reps.map((r) => rows[v][r].base[k]), b = reps.map((r) => rows[v][r].branch[k]);
		const d = reps.map((r) => rows[v][r].branch[k] - rows[v][r].base[k]);
		const unit = k === "idle" || k === "peak" ? " MiB" : " ms";
		console.log(`| ${k}${unit} | ${f1(q(a, .5))} / ${f1(q(a, .9))} / ${f1(q(a, .75) - q(a, .25))} | ${f1(q(b, .5))} / ${f1(q(b, .9))} / ${f1(q(b, .75) - q(b, .25))} | ${f1(q(d, .5))} | ${d.filter((x) => x < 0).length}/${d.length} |`);
	}
}
