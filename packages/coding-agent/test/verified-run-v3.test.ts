import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";
import { canonicalJson } from "../src/core/run-journal.ts";
import { commandEnvironmentDigest } from "../src/core/verified-run/broker.ts";
import { journalPath, readRunJournal } from "../src/core/verified-run/journal.ts";
import { digestBytes, digestObject, publishObject } from "../src/core/verified-run/storage.ts";
import { validateEvidenceReceipt } from "../src/guardrails/evidence-receipt.ts";

let root: string;
let workspace: string;
let stateRoot: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "run-v3-"));
	workspace = join(root, "workspace");
	stateRoot = join(root, "state");
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input.txt"), "hello");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function run(stdout = "hello") {
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId: "run-v3",
		goal: "copy",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["result.txt"],
		writer: ["/bin/cp", "input.txt", "result.txt"],
		checks: [{ claimId: "answer", argv: ["/bin/cat", "result.txt"], stdout }],
		budget: { workMs: 5000, verifyMs: 5000, cleanupMs: 1000, maxOutputBytes: 65536, maxFiles: 100, maxBytes: 65536 },
		apply: "artifact-only",
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	const plan = planVerifiedRun(contract);
	const coordinator = new RunCoordinator(stateRoot);
	await coordinator.start(
		contract,
		{
			schemaVersion: "omk.verified-command.v1",
			kind: "start",
			runId: contract.runId,
			commandId: "start",
			expectedRevision: 0,
			expectedGeneration: 0,
			contractDigest: plan.contractDigest,
		},
		{ approvedContractDigest: plan.contractDigest },
	);
	return { coordinator, evidence: coordinator.evidence(contract.runId) };
}

describe("verified candidate native receipt bridge", () => {
	it("returns native v3 receipts bound to observed execution and the exact candidate", async () => {
		const { evidence } = await run();
		expect(evidence.receiptFormat).toBe("v3");
		expect(evidence.receipts).toHaveLength(1);
		const receipt = validateEvidenceReceipt(evidence.receipts[0]);
		expect(receipt.core).toMatchObject({
			schemaVersion: 3,
			goalId: "run-v3",
			status: "passed",
			exitCode: 0,
			toolCallId: evidence.checks[0].executionId,
			command: { kind: "argv", executable: "/bin/cat", argv: ["result.txt"] },
		});
		expect(receipt.core.workspaceBefore).toEqual(receipt.core.workspaceAfter);
		expect(receipt.core.workspaceBefore.scope.artifactPaths).toEqual(["input.txt", "result.txt"]);
		expect(evidence.checks[0].receiptCoreDigest).toBe(receipt.envelope.coreSha256);
		expect(receipt.core.durationMs).toBe(Date.parse(receipt.core.finishedAt) - Date.parse(receipt.core.startedAt));
	});

	it.each(["missing", "corrupt"] as const)(
		"rejects %s native receipt even with a valid supervisor attestation",
		async (fault) => {
			const { coordinator, evidence } = await run();
			const receipt = validateEvidenceReceipt(evidence.receipts[0]);
			const path = join(stateRoot, "run-v3", "receipts", `${receipt.envelope.coreSha256}.json`);
			if (fault === "missing") rmSync(path);
			else writeFileSync(path, '{"verified":true}');
			expect(() => coordinator.inspect("run-v3")).toThrow();
			expect(() => coordinator.artifact("run-v3", evidence.candidateDigest, "result.txt")).toThrow();
		},
	);

	it("rejects injected mutable native-envelope authority metadata", async () => {
		const { coordinator, evidence } = await run();
		const receipt = validateEvidenceReceipt(evidence.receipts[0]);
		const changed = {
			...receipt,
			envelope: { ...receipt.envelope, ledgerBinding: { seq: 1, eventHash: "0".repeat(64) } },
		};
		writeFileSync(
			join(stateRoot, "run-v3", "receipts", `${receipt.envelope.coreSha256}.json`),
			JSON.stringify(changed),
		);
		expect(() => coordinator.evidence("run-v3")).toThrow(/integrity/);
	});

	it("reads the original command attestation without upgrading or rewriting it", async () => {
		const { coordinator, evidence } = await run();
		const runPath = join(stateRoot, "run-v3");
		const journal = readRunJournal(runPath);
		const first = journal?.records[0]?.event;
		const last = journal?.records.at(-1);
		if (!journal || first?.kind !== "created" || last?.event.kind !== "evaluated") throw new Error("invalid fixture");
		const receipt = {
			version: 1,
			runId: "run-v3",
			generation: 1,
			contractDigest: digestObject(first.contract),
			candidateDigest: evidence.candidateDigest,
			environmentDigest: commandEnvironmentDigest(first.contract),
			verifierDigest: digestObject(first.contract.checks),
			checks: evidence.checks.map(({ receiptCoreDigest: _native, ...observation }) => observation),
			verified: evidence.verified,
		};
		const authenticationTag = createHmac("sha256", readFileSync(join(runPath, "issuer.key")))
			.update("omk.verified-run.attestation.v1\0")
			.update(canonicalJson(receipt))
			.digest("hex");
		const envelope = { receipt, authenticationTag };
		const digest = digestObject(envelope);
		publishObject(join(runPath, "attestations", `${digest}.json`), envelope);
		let previous = "0".repeat(64);
		const legacy = journal.records
			.filter(({ event }) => event.kind !== "budget_anchored" && event.kind !== "process_ready")
			.map((record, index) => {
				const event =
					record.event.kind === "candidate"
						? { kind: "candidate" as const, digest: record.event.digest }
						: record.event.kind === "evaluated"
							? { ...record.event, receiptDigest: digest }
							: record.event;
				const material = { version: 2, seq: index + 1, generation: 1, previous, event };
				const hash = digestObject(material);
				previous = hash;
				return { ...material, hash };
			});
		writeFileSync(journalPath(runPath), `${legacy.map(canonicalJson).join("\n")}\n`);
		const before = readFileSync(journalPath(runPath));
		expect(coordinator.evidence("run-v3")).toMatchObject({ receiptFormat: "legacy", receipts: [], verified: true });
		expect(readFileSync(journalPath(runPath))).toEqual(before);
	});

	it("keeps execution success separate from the stdout assertion verdict", async () => {
		const { evidence } = await run("different");
		const receipt = validateEvidenceReceipt(evidence.receipts[0]);
		expect(receipt.core.status).toBe("passed");
		expect(evidence.verified).toBe(false);
	});

	it("redacts native output without changing the exact-byte assertion", async () => {
		const output = "Authorization: Bearer synthetic-fixture-output-123456";
		writeFileSync(join(workspace, "input.txt"), output);
		const { evidence } = await run(output);
		const receipt = validateEvidenceReceipt(evidence.receipts[0]);
		expect(evidence.verified).toBe(true);
		expect(evidence.checks[0].stdoutDigest).toBe(digestBytes(output));
		expect(receipt.core.output.stdout.sha256).not.toBe(digestBytes(output));
		expect(JSON.stringify(receipt)).not.toContain(output);
	});
});
