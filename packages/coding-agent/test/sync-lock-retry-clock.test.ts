import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileAuthStorageBackend } from "../src/core/auth-storage.ts";
import { appendRouterFeedbackRecord } from "../src/core/router-feedback-collector.ts";
import { FileSettingsStorage } from "../src/core/settings-manager.ts";

// The sync lock retry sleeps 20 ms between 10 attempts. Measured on the wall clock, a backward step
// (WSL2 steps it back by seconds) turns one 20 ms sleep into a busy spin as long as the step. A wall
// clock running at 1/20 speed makes that deterministic: each sleep would spin 400 ms.
describe("sync lock retry waits on the monotonic clock", () => {
	let dir: string;

	beforeEach(() => {
		dir = join(tmpdir(), `omk-sync-lock-clock-${process.pid}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(dir, { recursive: true, force: true });
	});

	const cases: Array<{ name: string; target: string; attempt: (dir: string) => unknown }> = [
		{
			name: "auth storage",
			target: "auth.json",
			attempt: (d) => new FileAuthStorageBackend(join(d, "auth.json")).withLock(() => ({ result: undefined })),
		},
		{
			name: "settings",
			target: "settings.json",
			attempt: (d) => new FileSettingsStorage(d, d).withLock("global", () => undefined),
		},
		{
			name: "router feedback ledger",
			target: "ledger.jsonl",
			attempt: (d) =>
				appendRouterFeedbackRecord(
					{
						routerVersion: "v4",
						laneType: "none",
						predictedClass: "code-gen",
						resolvedLevel: "medium",
						acceptedLevel: "medium",
						signal: "s2-accept",
						outcome: "accepted",
						lenBucket: 3,
						hadFence: false,
						hadDiff: false,
					},
					{ enabled: true, ledgerPath: join(d, "ledger.jsonl") },
				),
		},
	];

	it.each(cases)("$name gives up a held lock in about 200 ms", ({ target, attempt }) => {
		writeFileSync(join(dir, target), "{}");
		mkdirSync(join(dir, `${target}.lock`));
		const realNow = Date.now.bind(Date);
		const wallBase = realNow();
		const monoBase = performance.now();
		vi.spyOn(Date, "now").mockImplementation(() => wallBase + (performance.now() - monoBase) / 20);

		const started = performance.now();
		let outcome: unknown;
		try {
			outcome = attempt(dir);
		} catch (error) {
			outcome = (error as { code?: string }).code;
		}
		const elapsed = performance.now() - started;

		expect(JSON.stringify(outcome)).toMatch(/ELOCKED|io-error/);
		expect(elapsed).toBeLessThan(1_500);
	});
});
