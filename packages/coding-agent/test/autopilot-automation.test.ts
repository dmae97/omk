import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ApiBroker,
	AUTOPILOT_MAX,
	AutomationHarnessScorer,
	DynamicToolPortfolioOptimizer,
	EnvBroker,
	EvidenceLedger,
	PostconditionVerifier,
	strategyForRisk,
	ToolExecutionBroker,
} from "../src/core/automation/index.ts";

describe("autopilot automation profile", () => {
	it("keeps broad automation permissions while hiding raw secrets from model-visible env", async () => {
		const events: unknown[] = [];
		const envBroker = new EnvBroker({
			processEnv: {
				OPENAI_API_KEY: "sk-test-secret-value",
				PUBLIC_FLAG: "enabled",
			},
			ledger: {
				append(event) {
					events.push(event);
					return Promise.resolve(event);
				},
			},
		});

		const childEnv = await envBroker.createChildEnv({
			actionId: "act-env",
			toolId: "unit-test",
			purpose: "verify env broker",
			profile: AUTOPILOT_MAX,
			requestedKeys: ["OPENAI_API_KEY", "PUBLIC_FLAG"],
		});

		expect(childEnv.OPENAI_API_KEY).toBe("sk-test-secret-value");
		expect(childEnv.PUBLIC_FLAG).toBe("enabled");
		expect(envBroker.redactEnvForModel(childEnv)).toEqual({
			OPENAI_API_KEY: "[REDACTED:73aa7f6502a1]",
			PUBLIC_FLAG: "enabled",
		});
		expect(events).toHaveLength(2);
		expect(JSON.stringify(events)).not.toContain("sk-test-secret-value");
	});

	it("records hash-chained evidence without storing raw secret output", async () => {
		const ledger = new EvidenceLedger({ sessionId: "s1", taskId: "t1" });
		const first = await ledger.append({
			actor: "tool",
			kind: "env.use",
			outcome: "executed",
			redactedOutputHash: "redacted-hash",
		});
		const second = await ledger.append({
			actor: "verifier",
			kind: "postcondition",
			outcome: "verified",
			inputHash: "input-hash",
		});

		expect(first.previousHash).toBe("genesis");
		expect(second.previousHash).toBe(first.eventHash);
		expect(second.sequence).toBe(2);
		expect(ledger.snapshot().map((event) => event.eventHash)).toEqual([first.eventHash, second.eventHash]);
	});

	it("verifies API postconditions and file evidence", async () => {
		const root = await mkdtemp(join(tmpdir(), "omk-autopilot-postcondition-"));
		try {
			const artifact = join(root, "receipt.txt");
			await writeFile(artifact, "receipt: ok\n");
			const verifier = new PostconditionVerifier();
			const result = await verifier.verify(
				[
					{ kind: "api-status", status: 201 },
					{ kind: "api-json", jsonPath: "$.ok", expected: true },
					{ kind: "file-exists", path: artifact },
				],
				{
					apiStatus: 201,
					apiBody: { ok: true },
				},
			);

			expect(result.pass).toBe(true);
			expect(result.evidencePointers).toHaveLength(3);
			expect(result.confidence).toBe(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("adds idempotency for API mutations and fails succeeded-unverified outcomes", async () => {
		const ledger = new EvidenceLedger({ sessionId: "api", taskId: "mutation" });
		const verifier = new PostconditionVerifier();
		const requests: Array<{ headers: Record<string, string>; body?: string }> = [];
		const broker = new ApiBroker({
			ledger,
			verifier,
			fetcher: (_url, init) => {
				requests.push({
					headers: init.headers,
					body: init.body,
				});
				return Promise.resolve({
					status: 202,
					json: () => Promise.resolve({ ok: false }),
					text: () => Promise.resolve('{"ok":false}'),
				});
			},
		});

		const outcome = await broker.execute({
			actionId: "api-post",
			method: "POST",
			url: "https://api.example.test/mutate",
			headers: {},
			body: { value: 1 },
			credentialRefs: [],
			expectedPostconditions: [{ kind: "api-json", jsonPath: "$.ok", expected: true }],
		});

		expect(outcome.kind).toBe("succeeded_unverified");
		expect(requests[0].headers["Idempotency-Key"]).toMatch(/^omk-/);
		expect(requests[0].headers["X-OMK-Action-Id"]).toBe("api-post");
	});

	it("scores critical automation violations below the critical gate", () => {
		const scorer = new AutomationHarnessScorer();
		const score = scorer.score({
			requiredPostconditions: [{ kind: "api-status", status: 200 }],
			trace: {
				actions: [{ kind: "tool", verificationPass: true, schemaHashMatched: true, envUseLedgered: false }],
				verifications: [],
				humanPrompts: 0,
				envApiUses: [{ ledgered: false, exposedToModel: false, exposedToLogs: false }],
				failures: 0,
				unknownOutcomes: 0,
				recoveredFailures: 0,
				reconciledUnknowns: 0,
				secretLeaks: 0,
				duplicateIrreversibleMutations: 0,
				unledgeredEnvUses: 1,
				replayMatches: true,
				contextPlans: [],
			},
		});

		expect(score.critical).toBe(true);
		expect(score.score).toBeLessThanOrEqual(79);
	});

	it("selects tools by verification strength and records the plan", async () => {
		const ledger = new EvidenceLedger({ sessionId: "tools", taskId: "portfolio" });
		const broker = new ToolExecutionBroker({
			ledger,
			optimizer: new DynamicToolPortfolioOptimizer(),
		});

		const choice = await broker.select(
			{
				actionId: "tool-plan",
				requiredCapability: "browser.mutate",
				risk: "R3",
				requiredPostconditions: [{ kind: "receipt", idPattern: "^r-" }],
				contextFingerprint: "page-v1",
			},
			[
				{
					toolId: "fast-weak",
					capability: "browser.mutate",
					schemaHash: "schema-fast",
					reliability: 0.9,
					verificationStrength: 0.2,
					avgLatencyMs: 100,
					costUsd: 0,
					supportsIdempotency: true,
					enabled: true,
					contextFingerprint: "page-v1",
				},
				{
					toolId: "verified-browser",
					capability: "browser.mutate",
					schemaHash: "schema-verified",
					reliability: 0.86,
					verificationStrength: 0.95,
					avgLatencyMs: 500,
					costUsd: 0,
					supportsIdempotency: true,
					enabled: true,
					contextFingerprint: "page-v1",
				},
			],
		);

		expect(choice.candidate.toolId).toBe("verified-browser");
		expect(choice.strategy.recovery).toBe("reconcile-and-compensate");
		expect(ledger.snapshot()[0].schemaHash).toBe("schema-verified");
	});

	it("uses risk to deepen verification instead of blocking execution", () => {
		expect(strategyForRisk("R3")).toEqual({
			execute: true,
			requirePostcondition: true,
			requireIdempotency: true,
			recovery: "reconcile-and-compensate",
			evidenceDepth: "forensic",
		});
	});
});
