import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { waitForChildProcess } from "../../utils/child-process.ts";
import { killProcessTree, trackDetachedChildPid, untrackDetachedChildPid } from "../../utils/shell.ts";
import { scanShellComplexity } from "../workload-shell-scan.ts";
import type { OutputSnapshot } from "./output-accumulator.ts";
import { DEFAULT_MAX_BYTES } from "./truncate.ts";

type RtkFilter = "vitest" | "tsc";
const FILTER_TIMEOUT_MS = 2000;

/** Narrow lexical opt-in, not command rewriting or a claim about test success. */
export function rtkFilterForCommand(command: string): RtkFilter | undefined {
	if (scanShellComplexity(command).reasons.length > 0) return undefined;
	const args = command.trim().split(/\s+/);
	if (args.some((arg) => !/^[\w./:@=-]+$/.test(arg))) return undefined;
	let executable = basename(args[0] ?? "");
	if (executable === "node" || executable === "node.exe") {
		const script = args[1]?.replaceAll("\\", "/") ?? "";
		if (/(?:^|\/)node_modules\/vitest\/dist\/cli\.js$/.test(script)) executable = "vitest";
		else if (
			/(?:^|\/)node_modules\/(?:typescript\/bin\/tsc|@typescript\/native-preview\/bin\/tsgo\.js)$/.test(script)
		)
			executable = "tsc";
		else return undefined;
	}
	if (args.some((arg) => /^(?:-[hvw]|--(?:help|version|watch|all|showConfig)(?:=.*)?)$/i.test(arg))) return undefined;
	if (executable === "vitest" && (args.includes("--run") || args[1] === "run")) return "vitest";
	if ((executable === "tsc" || executable === "tsgo") && args.includes("--noEmit")) return "tsc";
	return undefined;
}

// shortcut: shell aliases, npm scripts and quoted/compound commands stay raw; expand only with output-parity evidence.
/** Only completed, bounded successful output is eligible; all other output stays raw. */
export function shouldFilterRtkOutput(command: string, snapshot: OutputSnapshot, exitCode: number | null): boolean {
	return (
		process.env.OMK_RTK_OUTPUT === "1" &&
		exitCode === 0 &&
		!snapshot.truncation.truncated &&
		Buffer.byteLength(snapshot.content) >= 1024 &&
		rtkFilterForCommand(command) !== undefined
	);
}

export async function filterRtkOutput(
	command: string,
	snapshot: OutputSnapshot,
	signal?: AbortSignal,
): Promise<OutputSnapshot> {
	if (signal?.aborted) throw new Error(`Command aborted. Full output: ${snapshot.fullOutputPath ?? "unavailable"}`);
	const filter = rtkFilterForCommand(command);
	if (!filter || !snapshot.fullOutputPath) return snapshot;
	const fallback: OutputSnapshot = { ...snapshot, outputFilter: { name: "rtk", filter, status: "fallback" } };
	const executable = process.env.OMK_RTK_PATH || "rtk";
	let child: ReturnType<typeof spawn> | undefined;
	let timer: NodeJS.Timeout | undefined;
	let unusable = false;
	let stdout = Buffer.alloc(0);
	const stop = () => {
		unusable = true;
		if (child?.pid) killProcessTree(child.pid);
	};
	try {
		child = spawn(executable, ["pipe", "--filter", filter], {
			cwd: tmpdir(),
			shell: false,
			detached: process.platform !== "win32",
			windowsHide: true,
			// Pipe mode needs no credentials, session metadata or project configuration.
			env: {
				PATH: process.env.PATH,
				SystemRoot: process.env.SystemRoot,
				NO_COLOR: "1",
				RTK_TELEMETRY_DISABLED: "1",
			},
			stdio: ["pipe", "pipe", "pipe"],
		});
		if (child.pid) trackDetachedChildPid(child.pid);
		const pending = waitForChildProcess(child);
		child.stdout?.on("data", (data: Buffer) => {
			if (stdout.length + data.length > DEFAULT_MAX_BYTES) stop();
			else stdout = Buffer.concat([stdout, data]);
		});
		child.stderr?.on("data", () => {
			unusable = true;
		});
		child.stdin?.on("error", () => {
			unusable = true;
		});
		signal?.addEventListener("abort", stop, { once: true });
		if (signal?.aborted) stop();
		timer = setTimeout(stop, FILTER_TIMEOUT_MS);
		child.stdin?.end(stripVTControlCharacters(snapshot.content));
		const code = await pending;
		if (signal?.aborted) throw new Error(`Command aborted. Full output: ${snapshot.fullOutputPath}`);
		const content = stdout.toString("utf8");
		if (
			code !== 0 ||
			unusable ||
			content.trim() === "" ||
			stdout.length +
				Buffer.byteLength(`\n\n[RTK ${filter} filtered output. Full output: ${snapshot.fullOutputPath}]`) >=
				Buffer.byteLength(snapshot.content)
		)
			return fallback;
		return { ...snapshot, content, outputFilter: { name: "rtk", filter, status: "applied" } };
	} catch {
		if (signal?.aborted) throw new Error(`Command aborted. Full output: ${snapshot.fullOutputPath}`);
		return fallback;
	} finally {
		if (timer) clearTimeout(timer);
		signal?.removeEventListener("abort", stop);
		if (child?.pid) untrackDetachedChildPid(child.pid);
	}
}
