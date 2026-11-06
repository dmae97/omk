import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSubscriptionUsage } from "../src/core/provider-usage.ts";
import {
	buildMuseCliEnvironment,
	fetchMetaUsage,
	type MuseUsageProbe,
	parseMetaUsageSnapshot,
} from "../src/core/provider-usage-meta.ts";
import { getSubscriptionUsageSource } from "../src/core/provider-usage-sources.ts";

const probe =
	(result: Awaited<ReturnType<MuseUsageProbe>>): MuseUsageProbe =>
	async () =>
		result;

describe("Meta (Muse Code) subscription usage", () => {
	it("maps the current and weekly windows, with resets converted to epoch seconds", () => {
		expect(
			parseMetaUsageSnapshot({
				window: { usedPercent: 42.4, windowDurationMins: 300, resetsAtMs: 1_800_000_000_999 },
				weekly: { usedPercent: "120", resetsAtMs: 1_800_500_000_000 },
			}),
		).toEqual([
			{ label: "5H", usedPercent: 42.4, resetsAt: 1_800_000_000 },
			{ label: "7D", usedPercent: 100, resetsAt: 1_800_500_000 },
		]);
		expect(parseMetaUsageSnapshot({ window: { usedPercent: 10, windowDurationMins: 90 } })).toEqual([
			{ label: "90M", usedPercent: 10 },
		]);
	});

	it("keeps missing or malformed windows unavailable rather than zero", () => {
		for (const value of [undefined, null, [], {}, { window: { usedPercent: "n/a" } }, { weekly: {} }]) {
			expect(parseMetaUsageSnapshot(value)).toBeUndefined();
		}
	});

	it("reports a missing CLI, a failed probe and an unobserved host distinctly", async () => {
		expect(await fetchMetaUsage("META", probe({ kind: "missing" }))).toEqual({
			label: "META",
			windows: [],
			message: "connect: install Muse Code CLI (muse)",
		});
		expect((await fetchMetaUsage("META", probe({ kind: "failed" }))).message).toBe("usage unavailable");
		expect((await fetchMetaUsage("META", probe({ kind: "read", payload: { usage: {} } }))).message).toBe(
			"no observed usage yet",
		);
		expect(
			(await fetchMetaUsage("META", probe({ kind: "read", payload: { usage: { tier: "Muse Pro" } } }))).message,
		).toBe("Muse Pro, no observed usage yet");
		const thrown: MuseUsageProbe = async () => {
			throw new Error("secret detail");
		};
		expect((await fetchMetaUsage("META", thrown)).message).toBe("usage unavailable");
	});

	it("routes the meta source through the probe without an OMK-held credential", async () => {
		expect(getSubscriptionUsageSource("meta")?.kind).toBe("meta");
		const session = {
			state: { model: { provider: "meta" } },
			modelRegistry: {
				isUsingOAuthProvider: (provider: string) => provider === "meta",
				getProviderAuthStatus: () => ({ configured: false }),
				getApiKeyForProvider: async () => {
					throw new Error("must not read a credential");
				},
			},
			settingsManager: { getSubscriptionUsageProviders: () => undefined },
		};
		// The rail lists the source only while the Meta login is configured.
		const read = probe({ kind: "read", payload: { usage: { window: { usedPercent: 7 } } } });
		expect(await loadSubscriptionUsage(session as never, fetch, "meta", undefined, read)).toEqual({
			label: "META",
			windows: [{ label: "5H", usedPercent: 7 }],
		});
	});

	it("forwards only the allowlisted, non-secret process environment", () => {
		const env = buildMuseCliEnvironment({ PATH: "/bin", HOME: "/home/u", META_API_KEY: "secret", GITHUB_TOKEN: "x" });
		expect(env).toEqual({ PATH: "/bin", HOME: "/home/u" });
	});
});

describe("Muse CLI probe", () => {
	const dirs: string[] = [];
	const savedPath = process.env.PATH;
	afterEach(() => {
		process.env.PATH = savedPath;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	/** A fake `muse` on PATH that speaks the MSP handshake and records its argv. */
	function fakeMuse(body: string): string {
		const dir = mkdtempSync(join(tmpdir(), "omk-fake-muse-"));
		dirs.push(dir);
		const script = join(dir, "muse");
		writeFileSync(
			script,
			`#!${process.execPath}\nconst fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(join(dir, "argv.json"))}, JSON.stringify(process.argv.slice(2)));\n${body}\n`,
		);
		chmodSync(script, 0o755);
		process.env.PATH = dir;
		return dir;
	}

	it.skipIf(process.platform === "win32")("reads usage over MSP and passes the read-only serve flags", async () => {
		const dir = fakeMuse(`
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
	const msg = JSON.parse(line);
	if (msg.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) + "\\n");
	if (msg.method === "usage/read")
		process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { usage: { window: { usedPercent: 33, windowDurationMins: 300 } } } }) + "\\n");
});
rl.on("close", () => process.exit(0));`);
		expect(await fetchMetaUsage("META")).toEqual({ label: "META", windows: [{ label: "5H", usedPercent: 33 }] });
		const argv = JSON.parse((await import("node:fs")).readFileSync(join(dir, "argv.json"), "utf8"));
		expect(argv).toEqual(["serve", "--provider", "meta", "--disable-write", "--disable-shell", "--no-session-log"]);
	});

	it.skipIf(process.platform === "win32")("treats a host that exits before answering as unavailable", async () => {
		fakeMuse("process.exit(1);");
		expect((await fetchMetaUsage("META")).message).toBe("usage unavailable");
	});

	it("reports a missing CLI when muse is not on PATH", async () => {
		const empty = mkdtempSync(join(tmpdir(), "omk-no-muse-"));
		dirs.push(empty);
		process.env.PATH = empty;
		expect((await fetchMetaUsage("META")).message).toBe("connect: install Muse Code CLI (muse)");
	});
});
