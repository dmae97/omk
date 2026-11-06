/**
 * Meta (Muse Code) subscription usage: the Muse Code host owns the account's
 * last-observed subscription window (MSP `usage/read`, ADR 32563 D2). The probe
 * spawns `muse serve` with tools disabled, runs the MSP initialize handshake,
 * asks `usage/read`, then closes stdin so the host exits — no prompt is ever
 * submitted and no model call is made. The host reports only what it observed
 * (a provider frame or a token mint), so a fresh host reports no usage yet.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { clampPercent, usageText } from "./provider-usage-text.ts";
import type { SubscriptionUsageSnapshot, SubscriptionUsageWindow } from "./provider-usage-types.ts";

const MUSE_CLI = "muse";
const MUSE_CLI_TIMEOUT_MS = 15_000;
const MUSE_EXIT_GRACE_MS = 2_000;
const MAX_MUSE_RESPONSE_BYTES = 1024 * 1024;
const MUSE_CONNECT_HINT = "connect: install Muse Code CLI (muse)";
const MUSE_UNOBSERVED_MESSAGE = "no observed usage yet";
/** Provider tools stay off: this probe only reads metadata and usage. */
const MUSE_SERVE_ARGS = [
	"serve",
	"--provider",
	"meta",
	"--disable-write",
	"--disable-shell",
	"--no-session-log",
] as const;
/** Same non-secret process context the QwenCloud CLI probe forwards. */
const MUSE_CLI_ENV_KEYS = [
	"PATH",
	"Path",
	"HOME",
	"USERPROFILE",
	"HOMEDRIVE",
	"HOMEPATH",
	"APPDATA",
	"LOCALAPPDATA",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_CACHE_HOME",
	"XDG_RUNTIME_DIR",
	"TMPDIR",
	"TEMP",
	"TMP",
	"SystemRoot",
	"WINDIR",
	"ComSpec",
	"PATHEXT",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
] as const;

/** `missing` = no CLI on PATH; `read` = a usage/read result object arrived; `failed` = spawn/handshake failure. */
export type MuseUsageProbeResult =
	| { readonly kind: "missing" }
	| { readonly kind: "read"; readonly payload: unknown }
	| { readonly kind: "failed" };

export type MuseUsageProbe = (timeoutMs: number) => Promise<MuseUsageProbeResult>;

export function buildMuseCliEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const childEnvironment: NodeJS.ProcessEnv = {};
	for (const key of MUSE_CLI_ENV_KEYS) {
		const value = source[key];
		if (value !== undefined) childEnvironment[key] = value;
	}
	return childEnvironment;
}

/** Map the MSP `SubscriptionUsage` member onto rail meters; weekly and tier are optional. */
export function parseMetaUsageSnapshot(value: unknown): readonly SubscriptionUsageWindow[] | undefined {
	const usage = record(value);
	if (!usage) return undefined;
	const current = metaWindow(record(usage.window), false);
	const weekly = metaWindow(record(usage.weekly), true);
	const windows = [current, weekly].filter(isDefined);
	return windows.length > 0 ? windows : undefined;
}

export async function fetchMetaUsage(
	label: string,
	probe: MuseUsageProbe = runMuseUsageProbe,
): Promise<SubscriptionUsageSnapshot> {
	const unavailable = (message: string): SubscriptionUsageSnapshot => ({ label, windows: [], message });
	try {
		const result = await probe(MUSE_CLI_TIMEOUT_MS);
		if (result.kind === "missing") return unavailable(MUSE_CONNECT_HINT);
		if (result.kind === "failed") return unavailable("usage unavailable");
		const usage = record(record(result.payload)?.usage);
		const windows = parseMetaUsageSnapshot(usage);
		if (windows) return { label, windows };
		// The host reports truthful absence until it observes a window; a folded tier still names the plan.
		const tier = usageText(stringValue(usage?.tier));
		return unavailable(tier === undefined ? MUSE_UNOBSERVED_MESSAGE : `${tier}, ${MUSE_UNOBSERVED_MESSAGE}`);
	} catch {
		return unavailable("usage unavailable");
	}
}

function metaWindow(entry: Record<string, unknown> | undefined, weekly: boolean): SubscriptionUsageWindow | undefined {
	if (!entry) return undefined;
	const usedPercent = finiteNumber(entry.usedPercent);
	if (usedPercent === undefined) return undefined;
	// resetsAtMs is epoch milliseconds; rail windows carry epoch seconds.
	const resetMs = finiteNumber(entry.resetsAtMs);
	const resetsAt = resetMs === undefined ? undefined : Math.floor(resetMs / 1000);
	return {
		label: weekly ? "7D" : windowLabel(entry.windowDurationMins),
		usedPercent: clampPercent(usedPercent),
		...(resetsAt === undefined ? {} : { resetsAt }),
	};
}

/** The provider's 5h-class block length usually arrives as `windowDurationMins`. */
function windowLabel(durationMins: unknown): string {
	const minutes = finiteNumber(durationMins);
	if (minutes === undefined || minutes <= 0) return "5H";
	return minutes % 60 === 0 ? `${minutes / 60}H` : `${Math.round(minutes)}M`;
}

function runMuseUsageProbe(timeoutMs: number): Promise<MuseUsageProbeResult> {
	return new Promise((resolve) => {
		let child: ChildProcess;
		try {
			child = spawn(MUSE_CLI, [...MUSE_SERVE_ARGS], {
				env: buildMuseCliEnvironment(process.env),
				stdio: ["pipe", "pipe", "ignore"],
				windowsHide: true,
			});
		} catch {
			resolve({ kind: "failed" });
			return;
		}
		let settled = false;
		let buffer = "";
		const timer = setTimeout(() => finish({ kind: "failed" }), timeoutMs);
		const finish = (result: MuseUsageProbeResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.stdin?.end();
			// The host exits on EOF; SIGKILL is the bounded fallback so none is left running.
			const killer = setTimeout(() => child.kill("SIGKILL"), MUSE_EXIT_GRACE_MS);
			killer.unref();
			child.once("exit", () => clearTimeout(killer));
			resolve(result);
		};
		child.on("error", (error) => {
			finish((error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "missing" } : { kind: "failed" });
		});
		child.once("close", () => finish({ kind: "failed" }));
		child.once("spawn", () =>
			write(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams() }),
		);
		child.stdout?.on("data", (chunk: Buffer) => {
			if (settled) return;
			buffer += chunk.toString("utf8");
			if (buffer.length > MAX_MUSE_RESPONSE_BYTES) {
				finish({ kind: "failed" });
				return;
			}
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) return;
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				if (!line.trim()) continue;
				let message: unknown;
				try {
					message = JSON.parse(line);
				} catch {
					continue;
				}
				const reply = record(message);
				if (reply?.id === 1 && reply.result !== undefined) {
					write(child, { jsonrpc: "2.0", method: "initialized" });
					write(child, { jsonrpc: "2.0", id: 2, method: "usage/read" });
				} else if (reply?.id === 2 && reply.result !== undefined) {
					finish({ kind: "read", payload: reply.result });
				}
			}
		});
	});
}

function initializeParams(): Record<string, unknown> {
	return {
		clientInfo: { name: "omk", version: "1" },
		capabilities: { requestedCapabilities: [], userInputDialogs: false },
	};
}

function write(child: ChildProcess, packet: Record<string, unknown>): void {
	child.stdin?.write(`${JSON.stringify(packet)}\n`);
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function finiteNumber(value: unknown): number | undefined {
	const number =
		typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
	return Number.isFinite(number) ? number : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}
