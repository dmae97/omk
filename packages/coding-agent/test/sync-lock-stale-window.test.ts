import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendRouterFeedbackRecord } from "../src/core/router-feedback-collector.ts";
import { FileSettingsStorage } from "../src/core/settings-manager.ts";

// proper-lockfile treats a lock as abandoned when its mtime is older than `stale` by Date.now(). With
// the 10 s default, a WSL2 wall-clock step of more than 10 s made another session's fresh lock look
// abandoned, so this writer deleted it and wrote alongside the live holder.
describe("sync lock stale window", () => {
	let dir: string;

	beforeEach(() => {
		dir = join(tmpdir(), `omk-sync-lock-stale-${process.pid}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(dir, { recursive: true, force: true });
	});

	const record = {
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
	};
	const cases: Array<{ name: string; target: string; attempt: (dir: string) => unknown }> = [
		{
			name: "settings",
			target: "settings.json",
			attempt: (d) => new FileSettingsStorage(d, d).withLock("global", () => '{"changed":true}'),
		},
		{
			name: "router feedback ledger",
			target: "ledger.jsonl",
			attempt: (d) => appendRouterFeedbackRecord(record, { enabled: true, ledgerPath: join(d, "ledger.jsonl") }),
		},
	];

	function holdLock(target: string, ageMs: number): string {
		writeFileSync(join(dir, target), "{}");
		const lockDir = join(dir, `${target}.lock`);
		mkdirSync(lockDir);
		const mtime = new Date(Date.now() - ageMs);
		utimesSync(lockDir, mtime, mtime);
		return lockDir;
	}

	function outcomeOf(attempt: () => unknown): string {
		try {
			return JSON.stringify(attempt() ?? "ok");
		} catch (error) {
			return String((error as { code?: string }).code);
		}
	}

	it.each(cases)("$name leaves a fresh lock alone after a 20 s wall-clock step", ({ target, attempt }) => {
		const lockDir = holdLock(target, 0);
		const realNow = Date.now.bind(Date);
		vi.spyOn(Date, "now").mockImplementation(() => realNow() + 20_000);

		expect(outcomeOf(() => attempt(dir))).toMatch(/ELOCKED|io-error/);
		expect(existsSync(lockDir)).toBe(true);
	});

	it.each(cases)("$name still reclaims a lock abandoned past the stale window", ({ target, attempt }) => {
		const lockDir = holdLock(target, 31_000);

		expect(outcomeOf(() => attempt(dir))).not.toMatch(/ELOCKED|io-error/);
		expect(existsSync(lockDir)).toBe(false);
	});
});
