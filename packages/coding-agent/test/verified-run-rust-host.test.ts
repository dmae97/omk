import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunContract, VERIFIED_COMMAND_VERSION } from "omk-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";
import * as broker from "../src/core/verified-run/broker.ts";

const executeSandbox = broker.executeSandbox;

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
let root: string;
let workspace: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "rust-host-"));
	workspace = join(root, "project");
	mkdirSync(workspace);
	if (binary) vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

function request(argv: readonly string[]) {
	return { workspace, argv, writable: true, timeoutMs: 10000, cleanupMs: 5000, maxOutputBytes: 4096 };
}
function nativeAncestor(pid: number): number | undefined {
	for (let depth = 0; depth < 5 && pid > 1; depth++) {
		if (readlinkSync(`/proc/${pid}/exe`) === binary) return pid;
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		pid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/)[1]);
	}
	return undefined;
}

describe.skipIf(!binary)("real Rust execution host (explicit EXECUTION_HOST_TEST_BINARY)", () => {
	it("runs behind the actual native owner only after the parent records readiness", async () => {
		let ready = false;
		const result = await executeSandbox({
			...request(["/bin/sh", "-c", "printf native > marker; printf result; printf error >&2"]),
			onReady: (identity) => {
				expect(existsSync(join(workspace, "marker"))).toBe(false);
				expect(nativeAncestor(identity.pid)).toBeDefined();
				ready = true;
			},
		});
		expect(ready).toBe(true);
		expect(result.failure).toBeNull();
		expect(result.stdout.toString()).toBe("result");
		expect(result.stderr.toString()).toBe("error");
		expect(readFileSync(join(workspace, "marker"), "utf8")).toBe("native");
	});

	it.each([new Error("journal rejected"), null, 0])(
		"does not release candidate code when journal admission throws %s",
		async (error) => {
			await expect(
				executeSandbox({
					...request(["/bin/sh", "-c", "touch marker"]),
					onReady: () => {
						throw error;
					},
				}),
			).rejects.toBe(error);
			expect(existsSync(join(workspace, "marker"))).toBe(false);
		},
	);

	it("cancels the entire namespace including detached descendants", async () => {
		const controller = new AbortController();
		const result = await executeSandbox({
			...request(["/bin/sh", "-c", "setsid /bin/sh -c 'sleep 1; touch escaped' & sleep 20"]),
			signal: controller.signal,
			onReady: () => {
				setTimeout(() => controller.abort(), 100);
			},
		});
		expect(result.failure).toBe("cancelled");
		await new Promise((resolve) => setTimeout(resolve, 1200));
		expect(existsSync(join(workspace, "escaped"))).toBe(false);
	}, 15000);

	it("enforces deadline and combined stdout/stderr retention", async () => {
		const deadline = await executeSandbox({ ...request(["/bin/sleep", "20"]), timeoutMs: 150, onReady: () => {} });
		expect(deadline.failure).toBe("deadline");
		const output = await executeSandbox({
			...request(["/bin/sh", "-c", "printf 12345678; printf abcdefgh >&2; sleep 20"]),
			maxOutputBytes: 8,
			onReady: () => {},
		});
		expect(output.failure).toBe("output_limit");
		expect(output.stdout.length + output.stderr.length).toBeLessThanOrEqual(8);
	});

	it("preserves readonly mounts and refuses execution without readiness", async () => {
		await expect(executeSandbox(request(["/bin/true"]))).rejects.toThrow(/unsupported_boundary/);
		const result = await executeSandbox({
			...request(["/bin/sh", "-c", "touch forbidden"]),
			writable: false,
			onReady: () => {},
		});
		expect(result.failure).toBe("execution_failed");
		expect(existsSync(join(workspace, "forbidden"))).toBe(false);
	});

	it.each(["normal", "crash"])(
		"runs real coordinator ownership with %s host settlement",
		async (mode) => {
			writeFileSync(join(workspace, "input.txt"), "original");
			const raw = {
				schemaVersion: "omk.verified-run.v1",
				profile: "linux-command-v1",
				runId: "native-run",
				goal: "Produce native result",
				workspace: { root: workspace, baseDigest: "0".repeat(64) },
				writablePaths: ["result.txt"],
				writer: ["/bin/sh", "-c", "printf hello > result.txt"],
				checks: [{ claimId: "greeting", argv: ["/bin/cat", "result.txt"], stdout: "hello" }],
				budget: {
					workMs: 30000,
					verifyMs: 30000,
					cleanupMs: 5000,
					maxOutputBytes: 4096,
					maxFiles: 100,
					maxBytes: 65536,
				},
				apply: "artifact-only",
			};
			const initial = planVerifiedRun(raw);
			const contract = parseRunContract({ ...raw, workspace: { root: workspace, baseDigest: initial.baseDigest } });
			const plan = planVerifiedRun(contract);
			const command = {
				schemaVersion: VERIFIED_COMMAND_VERSION,
				kind: "start",
				runId: contract.runId,
				commandId: "native-start",
				expectedRevision: 0,
				expectedGeneration: 0,
				contractDigest: plan.contractDigest,
			};
			const coordinator = new RunCoordinator(join(root, "state"));
			await expect(coordinator.start(contract, command, { approvedContractDigest: "f".repeat(64) })).rejects.toThrow(
				/approval/,
			);
			if (mode === "crash") {
				vi.spyOn(broker, "executeSandbox").mockImplementation((request) =>
					executeSandbox({
						...request,
						onReady: async (identity) => {
							await request.onReady?.(identity);
							const owner = nativeAncestor(identity.pid);
							if (owner === undefined) throw new Error("native owner missing");
							process.kill(owner, "SIGKILL");
						},
					}),
				);
			}
			const result = await coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest });
			// Normal: receipts are discarded once the authority recorded termination. Crash: none was witnessed.
			expect(readdirSync(join(root, "state", "native-witness"))).toEqual([]);
			// The record and committed-prefix marker survive a crash until witnessed settlement.
			expect(readdirSync(join(root, "state", "native-exec"))).toHaveLength(mode === "crash" ? 2 : 0);
			if (mode === "crash") {
				expect(result.settlement).toBe("quarantined");
				expect(result.activeExecutionIds).toHaveLength(1);
				expect(result.verification).not.toBe("verified");
				return;
			}
			expect(result).toMatchObject({ execution: "succeeded", settlement: "settled", verification: "verified" });
			expect(await coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest })).toEqual(
				result,
			);
			expect(existsSync(join(workspace, "result.txt"))).toBe(false);
			expect(coordinator.evidence(contract.runId).verified).toBe(true);
		},
		30000,
	);
});
