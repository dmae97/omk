// Worker cost harness. Spawns the exact subagent worker command line
// (node dist/cli.js --mode json -p --no-session --model <m> --append-system-prompt <f> "Task: ...")
// under /usr/bin/time -v, samples /proc, and writes raw JSONL per batch.
// usage: node harness.mjs <outDir> <variant fast|slow> <port> <concurrency> <label> [--cpu-prof]
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [outDirArg, variant, port, conc, label] = process.argv.slice(2, 7);
const outDir = (await import("node:path")).resolve(outDirArg);
const cpuProf = process.argv.includes("--cpu-prof");
const N = Number(conc);
const ROOT = process.env.HARNESS_ROOT;
const CLI = join(ROOT, "packages/coding-agent/dist/cli.js");
const ENVROOT = join(process.env.HARNESS_ENV_DIR, process.env.HARNESS_ARM, variant);
const agentDir = join(ENVROOT, "agent");
const home = join(ENVROOT, "home");
const cwd = join(ENVROOT, "project");
for (const d of [agentDir, home, cwd]) mkdirSync(d, { recursive: true });
if (variant === "tool") writeFileSync(join(cwd, "small.txt"), "small file for the tool-call scenario\n");
writeFileSync(join(agentDir, "models.json"), JSON.stringify({
	providers: { mockprov: { api: "openai-completions", baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "mock-key",
		compat: { maxTokensField: "max_tokens", supportsDeveloperRole: false, supportsStore: false },
		models: [{ id: "mock-model", reasoning: false, contextWindow: 128000, maxTokens: 4096 }] } },
}));
const promptFile = join(ENVROOT, "prompt-worker.md");
writeFileSync(promptFile, "You are a helper subagent. Answer briefly.\n");
mkdirSync(outDir, { recursive: true });
const now = () => performance.timeOrigin + performance.now();
const procRead = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const CLK = 100; // USER_HZ

const workers = [];
const t0batch = now();
for (let i = 0; i < N; i++) {
	const tag = `bench-${label}-w${i}`;
	const timeFile = join(outDir, `time-${tag}.txt`);
	const nodeArgs = [];
	if (cpuProf) nodeArgs.push("--cpu-prof", "--cpu-prof-dir", join(outDir, "cpuprof"));
	const args = ["-v", "-o", timeFile, process.execPath, ...nodeArgs, CLI,
		"--mode", "json", "-p", "--no-session", "--model", "mockprov/mock-model",
		"--append-system-prompt", promptFile, `Task: ${tag} reply with ok`];
	const env = { ...process.env, HOME: home, OMK_CODING_AGENT_DIR: agentDir, OMK_FINISH_CHECK: "0",
		OMK_OFFLINE: "1", OMK_TELEMETRY: "0", NO_COLOR: "1" };
	const t0 = now();
	const child = spawn("/usr/bin/time", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
	child.stdin.end();
	const w = { tag, t0, timePid: child.pid, nodePid: null, stdoutBytes: 0, stdoutHasOk: false, stderr: "", exit: null, tExit: null, samples: [] };
	let out = "";
	child.stdout.on("data", (d) => { out += d; w.stdoutBytes += d.length; });
	child.stderr.on("data", (d) => { w.stderr += d; });
	child.on("exit", (code) => { w.exit = code; w.tExit = now(); w.stdoutHasOk = out.includes("mock ok"); });
	workers.push(w);
}

// sampler
const box = [];
let prevCpu = null;
const sample = () => {
	const t = now();
	for (const w of workers) {
		if (w.exit !== null) continue;
		if (!w.nodePid) {
			const ch = procRead(`/proc/${w.timePid}/task/${w.timePid}/children`);
			if (ch && ch.trim()) w.nodePid = Number(ch.trim().split(/\s+/)[0]);
		}
		if (!w.nodePid) continue;
		const st = procRead(`/proc/${w.nodePid}/status`);
		const stat = procRead(`/proc/${w.nodePid}/stat`);
		const io = procRead(`/proc/${w.nodePid}/io`);
		if (!st || !stat) continue;
		const rss = Number(st.match(/VmRSS:\s+(\d+)/)?.[1] ?? 0) / 1024;
		const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
		const cpuMs = ((Number(f[11]) + Number(f[12])) / CLK) * 1000;
		const rb = io ? Number(io.match(/read_bytes:\s+(\d+)/)?.[1] ?? 0) : null;
		w.samples.push({ t, rss, cpuMs, readBytes: rb });
	}
	const cpuLine = procRead("/proc/stat").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
	const total = cpuLine.reduce((a, b) => a + b, 0);
	const idle = cpuLine[3] + cpuLine[4];
	const iowait = cpuLine[4];
	let util = null, iow = null;
	if (prevCpu) { const dt = total - prevCpu.total; util = dt > 0 ? 1 - (idle - prevCpu.idle) / dt : null; iow = dt > 0 ? (iowait - prevCpu.iowait) / dt : null; }
	prevCpu = { total, idle, iowait };
	const mem = procRead("/proc/meminfo");
	const avail = Number(mem.match(/MemAvailable:\s+(\d+)/)[1]) / 1024;
	const load = procRead("/proc/loadavg").trim();
	const psi = {};
	for (const k of ["cpu", "memory", "io"]) { const p = procRead(`/proc/pressure/${k}`); if (p) psi[k] = p.split("\n")[0]; }
	box.push({ t, util, iowait: iow, memAvailMiB: avail, load, psi, liveRssMiB: workers.reduce((a, w) => a + (w.exit === null && w.samples.length && w.samples.at(-1).t === t ? w.samples.at(-1).rss : 0), 0) });
};
const iv = setInterval(sample, 50);
sample();
await new Promise((resolve) => { const c = setInterval(() => { if (workers.every((w) => w.exit !== null)) { clearInterval(c); resolve(); } }, 20); });
clearInterval(iv);
for (const w of workers) {
	const tf = join(outDir, `time-${w.tag}.txt`);
	const txt = existsSync(tf) ? readFileSync(tf, "utf8") : "";
	const g = (re) => { const m = txt.match(re); return m ? m[1] : null; };
	const el = g(/Elapsed \(wall clock\) time \(h:mm:ss or m:ss\): ([\d:.]+)/);
	const elS = el ? el.split(":").reduce((a, b) => a * 60 + Number(b), 0) : null;
	w.time = { userS: Number(g(/User time \(seconds\): ([\d.]+)/)), sysS: Number(g(/System time \(seconds\): ([\d.]+)/)), wallS: elS,
		maxRssMiB: Number(g(/Maximum resident set size \(kbytes\): (\d+)/)) / 1024, majFlt: Number(g(/Major \(requiring I\/O\) page faults: (\d+)/)),
		minFlt: Number(g(/Minor \(reclaiming a frame\) page faults: (\d+)/)), fsIn: Number(g(/File system inputs: (\d+)/)),
		volCs: Number(g(/Voluntary context switches: (\d+)/)), invCs: Number(g(/Involuntary context switches: (\d+)/)) };
	w.stderr = w.stderr.slice(0, 2000);
}
appendFileSync(join(outDir, "workers.jsonl"), workers.map((w) => JSON.stringify({ label, variant, N, t0batch, ...w })).join("\n") + "\n");
appendFileSync(join(outDir, "box.jsonl"), JSON.stringify({ label, variant, N, t0batch, box }) + "\n");
console.log(`${label}: done ${workers.map((w) => `${w.exit}/${w.stdoutHasOk ? "ok" : "NOOK"}`).join(" ")}`);
