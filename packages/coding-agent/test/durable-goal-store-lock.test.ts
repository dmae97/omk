import { existsSync, mkdirSync, readdirSync, utimesSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDurableGoal } from "../src/core/durable-goal.ts";
import { DurableGoalStore } from "../src/core/durable-goal-store.ts";

const T0 = "2026-08-18T00:00:00.000Z";
const T1 = "2026-08-18T00:01:00.000Z";

// The goal journal lock is proper-lockfile's mtime-refreshed directory. Staleness compares that mtime
// with Date.now(), so a 10 s window let a WSL2 wall-clock step of more than 10 s hand another session's
// live lock to this writer, and two writers then appended on top of the same revision.
describe("durable goal store lock", () => {
	const roots: string[] = [];
	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	});

	async function createdStore(): Promise<{ store: DurableGoalStore; filePath: string }> {
		const root = await mkdtemp(join(tmpdir(), "omk-goal-lock-"));
		roots.push(root);
		const filePath = join(root, "goal.json");
		const store = new DurableGoalStore(filePath);
		await store.create(createDurableGoal({ id: "goal-1", objective: "Ship", maxRounds: 3, now: T0 }));
		return { store, filePath };
	}

	function holdLock(filePath: string, ageMs: number): void {
		mkdirSync(`${filePath}.lock`);
		const mtime = new Date(Date.now() - ageMs);
		utimesSync(`${filePath}.lock`, mtime, mtime);
	}

	it("leaves another session's fresh lock alone after a 20 s wall-clock step", async () => {
		const { store, filePath } = await createdStore();
		const ref = (await store.current())?.ref;
		holdLock(filePath, 0);
		const realNow = Date.now.bind(Date);
		vi.spyOn(Date, "now").mockImplementation(() => realNow() + 20_000);

		await expect(store.transition({ kind: "pause", ref: ref! }, T1)).rejects.toMatchObject({ code: "ELOCKED" });
		expect(existsSync(`${filePath}.lock`)).toBe(true);
		expect((await store.readJournal())?.revisions).toHaveLength(1);
	});

	it("still reclaims a lock abandoned past the stale window", async () => {
		const { store, filePath } = await createdStore();
		const ref = (await store.current())?.ref;
		holdLock(filePath, 31_000);

		await store.transition({ kind: "pause", ref: ref! }, T1);
		expect((await store.readJournal())?.revisions).toHaveLength(2);
		expect(existsSync(`${filePath}.lock`)).toBe(false);
	});

	it("fails the write instead of crashing the process when the lock is lost", async () => {
		const { store, filePath } = await createdStore();
		const ref = (await store.current())?.ref;
		let heldRelease: (() => Promise<void>) | undefined;
		const realLock = lockfile.lock.bind(lockfile);
		vi.spyOn(lockfile, "lock").mockImplementationOnce(async (file, options) => {
			const release = await realLock(file, options);
			heldRelease = release;
			// proper-lockfile calls onCompromised from a timer; without a handler it throws there,
			// which is an uncaught exception that ends the whole OMK process.
			const onCompromised = options?.onCompromised;
			if (!onCompromised) throw new Error("no onCompromised handler: a lost lock would crash the process");
			onCompromised(
				Object.assign(new Error("Unable to update lock within the stale threshold"), { code: "ECOMPROMISED" }),
			);
			return release;
		});

		await expect(store.transition({ kind: "pause", ref: ref! }, T1)).rejects.toMatchObject({ code: "ECOMPROMISED" });
		expect((await store.readJournal())?.revisions).toHaveLength(1);
		expect(readdirSync(join(filePath, "..")).filter((name) => name.endsWith(".tmp"))).toEqual([]);
		await heldRelease?.();
	});
});
