// A/B analysis for spec 043 (base = main worktree, branch = PR head).
// usage: node analyze-ab.mjs <rawDir> [outDir]
// Prints medians/p90/IQR per scenario and writes, into <rawDir> and (if given) <outDir>:
//   pairs.tsv   - scenario, metric, pair, base, branch: input for paired_verdict.py
//                 fast: startup_ms, peak_mib | slow: startup_ms, idle_mib | tool: tool_wall_ms, tool_peak_mib
//   conc16.tsv  - same format, scenario c16, metric startup_p90_ms, one row per rep (16 workers at once)
// Only runs that exit 0 with the expected mock traffic are paired; others are listed and dropped.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [D, outDir] = process.argv.slice(2);
const ws = readFileSync(join(D, "workers.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const mock = {};
for (const v of ["fast", "slow", "tool"]) {
	const f = join(D, `mock-${v}.jsonl`);
	if (!existsSync(f)) continue;
	for (const l of readFileSync(f, "utf8").trim().split("\n")) {
		const r = JSON.parse(l);
		(mock[r.tag] ??= []).push(r);
	}
}
const q = (a, p) => {
	const s = [...a].sort((x, y) => x - y);
	if (!s.length) return Number.NaN;
	const i = (s.length - 1) * p;
	const lo = Math.floor(i);
	const hi = Math.ceil(i);
	return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const iqr = (a) => q(a, 0.75) - q(a, 0.25);
const f1 = (x) => x.toFixed(1);

// Single-worker scenarios: rows[scenario][rep][arm] = metrics
const rows = {};
// 16-at-once: c16[rep][arm] = startup p90 over the batch
const c16 = {};
const c16ok = {};
const dropped = [];
for (const w of ws) {
	const m = w.tag.match(/^bench-(base|branch)-(fast|slow|tool|c16)-r(\w+)-w(\d+)$/);
	if (!m) continue;
	const [, arm, scen, rep] = m;
	if (rep === "w0") continue; // warm-up
	const reqs = mock[w.tag] ?? [];
	if (scen === "c16") {
		const ok = w.exit === 0 && w.stdoutHasOk && reqs.length === 1;
		((c16[rep] ??= {})[arm] ??= []).push(ok ? reqs[0].arrive - w.t0 : Number.NaN);
		if (!ok) dropped.push(w.tag);
		continue;
	}
	const toolOk =
		scen !== "tool" || (reqs.length === 2 && reqs[0].turn === 1 && reqs[1].turn === 2 && reqs[0].hasReadTool);
	const ok = reqs.length > 0 && w.exit === 0 && w.stdoutHasOk && toolOk;
	if (!ok) {
		dropped.push(w.tag);
		continue;
	}
	const mk = reqs[0];
	let idle = Number.NaN;
	if (scen === "slow") {
		const s = w.samples.filter((x) => x.t >= mk.arrive + 300 && x.t <= mk.respond - 200).map((x) => x.rss);
		idle = q(s, 0.5);
	}
	((rows[scen] ??= {})[rep] ??= {})[arm] = {
		startup_ms: mk.arrive - w.t0,
		wall_ms: w.tExit - w.t0,
		cpu_ms: (w.time.userS + w.time.sysS) * 1000,
		peak_mib: w.time.maxRssMiB,
		idle_mib: idle,
	};
}

// metric name in pairs.tsv -> field
const METRICS = {
	fast: [["startup_ms", "startup_ms"], ["peak_mib", "peak_mib"]],
	slow: [["startup_ms", "startup_ms"], ["idle_mib", "idle_mib"]],
	tool: [["tool_wall_ms", "wall_ms"], ["tool_peak_mib", "peak_mib"]],
};
const tsv = ["scenario\tmetric\tpair\tbase\tbranch"];
let toolWallIqr = Number.NaN;
for (const scen of ["fast", "slow", "tool"]) {
	if (!rows[scen]) continue;
	const reps = Object.keys(rows[scen])
		.filter((r) => rows[scen][r].base && rows[scen][r].branch)
		.sort((a, b) => Number(a) - Number(b));
	console.log(`\n## ${scen}: ${reps.length} complete pairs`);
	console.log("| metric | main med / p90 / IQR | branch med / p90 / IQR | paired diff med (branch−main) | pairs branch<main |");
	console.log("|---|---|---|---|---|");
	const extra = scen === "tool" ? [["cpu_ms", "cpu_ms"]] : scen === "fast" ? [["cpu_ms", "cpu_ms"]] : [["peak_mib", "peak_mib"]];
	for (const [name, field] of [...METRICS[scen], ...extra]) {
		const a = reps.map((r) => rows[scen][r].base[field]);
		const b = reps.map((r) => rows[scen][r].branch[field]);
		const d = reps.map((r) => rows[scen][r].branch[field] - rows[scen][r].base[field]);
		const inTsv = METRICS[scen].some(([n]) => n === name);
		console.log(
			`| ${name}${inTsv ? "" : " (not in pairs.tsv)"} | ${f1(q(a, 0.5))} / ${f1(q(a, 0.9))} / ${f1(iqr(a))} | ${f1(q(b, 0.5))} / ${f1(q(b, 0.9))} / ${f1(iqr(b))} | ${f1(q(d, 0.5))} | ${d.filter((x) => x < 0).length}/${d.length} |`,
		);
		if (!inTsv) continue;
		for (const r of reps) tsv.push(`${scen}\t${name}\t${r}\t${rows[scen][r].base[field]}\t${rows[scen][r].branch[field]}`);
		if (name === "tool_wall_ms") toolWallIqr = iqr(a);
	}
}

const c16tsv = ["scenario\tmetric\tpair\tbase\tbranch"];
const c16reps = Object.keys(c16)
	.filter((r) => c16[r].base && c16[r].branch)
	.sort((a, b) => Number(a) - Number(b));
if (c16reps.length) {
	console.log(`\n## c16 (16 workers at once, fast mock): ${c16reps.length} reps`);
	console.log("| rep | main startup p90 ms | branch startup p90 ms | diff |");
	console.log("|---|---|---|---|");
	for (const r of c16reps) {
		const [a, b] = ["base", "branch"].map((arm) => q(c16[r][arm].filter(Number.isFinite), 0.9));
		console.log(`| ${r} | ${f1(a)} | ${f1(b)} | ${f1(b - a)} |`);
		c16tsv.push(`c16\tstartup_p90_ms\t${r}\t${a}\t${b}`);
	}
}

if (dropped.length) console.log(`\ndropped (bad exit or mock traffic): ${dropped.join(" ")}`);
const write = (name, lines) => {
	if (lines.length < 2) return;
	writeFileSync(join(D, name), `${lines.join("\n")}\n`);
	if (outDir) copyFileSync(join(D, name), join(outDir, name));
	console.log(`wrote ${join(D, name)}${outDir ? ` and ${join(outDir, name)}` : ""}`);
};
write("pairs.tsv", tsv);
write("conc16.tsv", c16tsv);
if (Number.isFinite(toolWallIqr)) console.log(`main IQR tool_wall_ms = ${toolWallIqr.toFixed(1)} (pass to --noreg tool_wall_ms=${toolWallIqr.toFixed(1)})`);
console.log(
	`\nverdict: python3 /workspace/omk-bench-analyst/paired_verdict.py pairs.tsv --target startup_ms=-25 --target idle_mib=-5 --noreg tool_peak_mib=5${Number.isFinite(toolWallIqr) ? ` --noreg tool_wall_ms=${toolWallIqr.toFixed(1)}` : ""}`,
);
