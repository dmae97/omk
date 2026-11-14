import { spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRunAuthorityStore, runAuthorityProbe } from "../src/core/verified-run/authority-runtime.ts";
import { executeSandbox } from "../src/core/verified-run/broker.ts";
import type { NamespaceIdentity } from "../src/core/verified-run/namespace-identity.ts";
import { probeNamespace } from "../src/core/verified-run/namespace-identity.ts";
import {
	nativeWitnessDir,
	nativeWitnessRecorded,
	prepareNativeWitnessDir,
	probeWithNativeWitness,
} from "../src/core/verified-run/native-witness.ts";
import { identityFromSandboxInfo } from "../src/core/verified-run/process-gate.ts";

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
let root: string;
let dir: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "native-witness-"));
	dir = prepareNativeWitnessDir(nativeWitnessDir(root));
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

/** A previous-boot identity: the live probe can only answer `unknown`. */
const rebooted: NamespaceIdentity = Object.freeze({
	pid: 4242,
	startTicks: "987654",
	namespace: "pid:[4026532000]",
	bootId: "0123abcd-0000-4000-8000-00000000beef",
});
const receiptPath = join("0123abcd-0000-4000-8000-00000000beef-4026532000-4242-987654.json");
const canonical =
	'{"version":1,"kind":"terminated","identity":{"pid":4242,"startTicks":"987654","namespace":"pid:[4026532000]","bootId":"0123abcd-0000-4000-8000-00000000beef"}}\n';

function writeReceipt(bytes = canonical, mode = 0o600): string {
	const path = join(dir, receiptPath);
	writeFileSync(path, bytes, { mode });
	chmodSync(path, mode);
	return path;
}

describe("native durable termination receipts", () => {
	it("resolves an inconclusive probe only with the exact owner-only receipt", () => {
		expect(probeNamespace(rebooted)).toBe("unknown");
		expect(probeWithNativeWitness(rebooted, dir)).toBe("unknown");
		const path = writeReceipt();
		expect(probeWithNativeWitness(rebooted, dir)).toBe("gone");
		writeFileSync(path, canonical.replace("987654", "987655"));
		expect(probeWithNativeWitness(rebooted, dir)).toBe("unknown");
		rmSync(path);
		writeReceipt(canonical, 0o620);
		expect(probeWithNativeWitness(rebooted, dir)).toBe("unknown");
		rmSync(path);
		const elsewhere = join(root, "forged.json");
		writeFileSync(elsewhere, canonical, { mode: 0o600 });
		symlinkSync(elsewhere, path);
		expect(probeWithNativeWitness(rebooted, dir)).toBe("unknown");
		rmSync(path);
		writeReceipt();
		chmodSync(dir, 0o750);
		expect(probeWithNativeWitness(rebooted, dir)).toBe("unknown");
	});

	it("never overrides a live namespace init", () => {
		const stat = readFileSync("/proc/self/stat", "utf8");
		const self: NamespaceIdentity = {
			pid: process.pid,
			startTicks: stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/)[19] ?? "",
			namespace: readlinkSync("/proc/self/ns/pid"),
			bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
		};
		expect(probeNamespace(self)).toBe("alive");
		const inode = /\d+/.exec(self.namespace)?.[0];
		writeFileSync(
			join(dir, `${self.bootId}-${inode}-${self.pid}-${self.startTicks}.json`),
			`{"version":1,"kind":"terminated","identity":{"pid":${self.pid},"startTicks":"${self.startTicks}","namespace":"${self.namespace}","bootId":"${self.bootId}"}}\n`,
			{ mode: 0o600 },
		);
		expect(nativeWitnessRecorded(dir, self)).toBe(true);
		expect(probeWithNativeWitness(self, dir)).toBe("alive");
	});

	it("refuses a shared or redirected receipt directory", () => {
		chmodSync(dir, 0o770);
		expect(() => prepareNativeWitnessDir(dir)).toThrow(/witness/);
		const link = join(root, "linked");
		symlinkSync(dir, link);
		expect(() => prepareNativeWitnessDir(link)).toThrow(/witness/);
	});

	it("restart reconciliation settles a quarantined grant through the state-root receipt", () => {
		const runPath = join(root, "run-1");
		mkdirSync(runPath);
		const claims = [
			{ namespace: "filesystem", instanceId: "verified-run", canonicalKey: "x", access: "write", generation: "0" },
		] as const;
		const first = openRunAuthorityStore(runPath);
		const admission = first.acquire({
			sessionId: "run-1",
			incarnation: first.register("run-1"),
			commandId: "exec-1",
			intentDigest: "a".repeat(64),
			claims,
			now: Date.now(),
			ttl: 60_000,
		});
		if (admission.status !== "granted") throw new Error("not granted");
		expect(first.dispatchIntent(admission.token, "exec-1")).toBe(true);
		expect(first.effectStarted(admission.token, claims, rebooted)).toBe(true);
		first.release();

		const grantState = (store: ReturnType<typeof openRunAuthorityStore>) =>
			[...store.state.grants.values()].find((grant) => grant.commandId === "exec-1")?.state;
		const unresolved = openRunAuthorityStore(runPath);
		expect(grantState(unresolved)).toBe("quarantined");
		const grant = [...unresolved.state.grants.values()].find((entry) => entry.commandId === "exec-1");
		if (!grant) throw new Error("grant missing");
		expect(runAuthorityProbe(grant)).toBe("unknown");
		unresolved.release();

		writeReceipt();
		expect(runAuthorityProbe(grant, root)).toBe("terminated");
		const reconciled = openRunAuthorityStore(runPath);
		expect(grantState(reconciled)).toBe("terminated");
		reconciled.release();
	});
});

describe.skipIf(!binary)("real Rust host receipts (explicit EXECUTION_HOST_TEST_BINARY)", () => {
	const request = (workspace: string, argv: readonly string[]) => ({
		workspace,
		argv,
		writable: true,
		timeoutMs: 10_000,
		cleanupMs: 5_000,
		maxOutputBytes: 4096,
		witnessDir: dir,
	});

	it("writes the byte-exact receipt Node accepts after a witnessed drain", async () => {
		if (binary) vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary);
		const workspace = join(root, "project");
		mkdirSync(workspace);
		let identity: NamespaceIdentity | undefined;
		const result = await executeSandbox({
			...request(workspace, ["/bin/true"]),
			onReady: (observed) => {
				identity = observed;
			},
		});
		expect(result.failure).toBeNull();
		if (!identity) throw new Error("no identity");
		expect(nativeWitnessRecorded(dir, identity)).toBe(true);
		const [name] = readdirSync(dir);
		expect(statSync(join(dir, name ?? "")).mode & 0o777).toBe(0o600);
	});

	it("records termination after losing its parent mid-execution", async () => {
		const workspace = join(root, "project");
		mkdirSync(workspace);
		const requestId = "b".repeat(32);
		const child = spawn(binary ?? "", [], { env: {}, stdio: ["pipe", "pipe", "pipe"] });
		let identity: NamespaceIdentity | undefined;
		let buffered = "";
		const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			buffered += chunk;
			for (let end = buffered.indexOf("\n"); end !== -1; end = buffered.indexOf("\n")) {
				const event = JSON.parse(buffered.slice(0, end)) as { type: string; info?: unknown };
				buffered = buffered.slice(end + 1);
				if (event.type === "ready") {
					identity = identityFromSandboxInfo(JSON.stringify(event.info));
					child.stdin.write(`${JSON.stringify({ type: "commit", requestId })}\n`);
					setTimeout(() => child.stdin.end(), 100);
				}
			}
		});
		child.stdin.write(
			`${JSON.stringify({
				version: 1,
				requestId,
				workspace,
				argv: ["/bin/sh", "-c", "sleep 30; touch survived"],
				writable: true,
				timeoutMs: 20_000,
				cleanupMs: 5_000,
				maxOutputBytes: 4096,
				witnessDir: dir,
			})}\n`,
		);
		await exited;
		if (!identity) throw new Error("no identity");
		expect(probeNamespace(identity)).toBe("gone");
		expect(nativeWitnessRecorded(dir, identity)).toBe(true);
		expect(existsSync(join(workspace, "survived"))).toBe(false);
	}, 20_000);
});
