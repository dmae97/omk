import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { type DurableGoalCommand, DurableGoalError, type DurableGoalSnapshot } from "./durable-goal.ts";
import { parseDurableGoalSnapshot } from "./durable-goal-parse.ts";
import { applyDurableGoalCommand } from "./durable-goal-reducer.ts";

export const DURABLE_GOAL_JOURNAL_SCHEMA_VERSION = "omk.goal.journal.v1" as const;
// Staleness is lock mtime vs Date.now(): a 10 s default let a wall-clock step hand a live lock to another writer.
const GOAL_LOCK_STALE_MS = 30_000;

export interface DurableGoalJournal {
	readonly schemaVersion: typeof DURABLE_GOAL_JOURNAL_SCHEMA_VERSION;
	readonly goalId: string;
	readonly revisions: readonly DurableGoalSnapshot[];
}

export class DurableGoalStore {
	readonly filePath: string;

	constructor(filePath: string) {
		if (filePath.trim().length === 0) throw new DurableGoalError("invalid-input", "goal file path must not be empty");
		this.filePath = filePath;
	}

	async readJournal(): Promise<DurableGoalJournal | null> {
		return this.readUnlocked();
	}

	async current(): Promise<DurableGoalSnapshot | null> {
		const journal = await this.readUnlocked();
		return journal?.revisions.at(-1) ?? null;
	}

	async create(goal: DurableGoalSnapshot): Promise<DurableGoalSnapshot> {
		return this.withLock(async (assertHeld) => {
			if ((await this.readUnlocked()) !== null) {
				throw new DurableGoalError("store-exists", "durable goal already exists");
			}
			const initial = parseDurableGoalSnapshot(goal);
			if (
				initial.ref.revision !== 1 ||
				initial.status !== "active" ||
				initial.completedRounds !== 0 ||
				initial.evidence.length !== 0 ||
				initial.checkpoint !== undefined ||
				initial.createdAt !== initial.updatedAt ||
				initial.createdAt !== initial.generationStartedAt
			) {
				throw invalidStore();
			}
			await this.writeUnlocked(
				{ schemaVersion: DURABLE_GOAL_JOURNAL_SCHEMA_VERSION, goalId: initial.ref.id, revisions: [initial] },
				assertHeld,
			);
			return initial;
		});
	}

	async transition(command: DurableGoalCommand, now: string): Promise<DurableGoalSnapshot> {
		return this.withLock(async (assertHeld) => {
			const journal = await this.readUnlocked();
			const current = journal?.revisions.at(-1);
			if (!journal || !current) throw new DurableGoalError("store-missing", "durable goal does not exist");
			const next = applyDurableGoalCommand(current, command, now);
			await this.writeUnlocked({ ...journal, revisions: [...journal.revisions, next] }, assertHeld);
			return next;
		});
	}

	private async withLock<T>(operation: (assertHeld: () => void) => Promise<T>): Promise<T> {
		const directory = dirname(this.filePath);
		await mkdir(directory, { recursive: true });
		let lost: Error | undefined;
		const release = await lockfile.lock(this.filePath, {
			realpath: false,
			stale: GOAL_LOCK_STALE_MS,
			retries: { retries: 5, factor: 1, minTimeout: 5, maxTimeout: 25 },
			// The default handler throws from a timer, an uncaught exception that ends the process.
			onCompromised: (error) => {
				lost = error;
			},
		});
		try {
			return await operation(() => {
				if (lost) throw lost;
			});
		} finally {
			// A compromised lock is already released; releasing again only rejects with ERELEASED.
			if (!lost) await release();
		}
	}

	private async readUnlocked(): Promise<DurableGoalJournal | null> {
		let raw: string;
		try {
			raw = await readFile(this.filePath, "utf8");
		} catch (error) {
			if (isFileSystemError(error, "ENOENT")) return null;
			throw error;
		}
		try {
			return parseJournal(JSON.parse(raw));
		} catch (error) {
			if (error instanceof DurableGoalError && error.code === "invalid-store") throw error;
			throw new DurableGoalError("invalid-store", "durable goal journal is invalid");
		}
	}

	private async writeUnlocked(journal: DurableGoalJournal, assertHeld: () => void): Promise<void> {
		const tempPath = join(dirname(this.filePath), `.goal-${randomUUID()}.tmp`);
		try {
			await writeFile(tempPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
			// Another writer may own the journal once the lock is lost; publishing now could drop its revision.
			assertHeld();
			await rename(tempPath, this.filePath);
		} catch (error) {
			await rm(tempPath, { force: true });
			throw error;
		}
	}
}

function parseJournal(value: unknown): DurableGoalJournal {
	if (!isRecord(value) || value.schemaVersion !== DURABLE_GOAL_JOURNAL_SCHEMA_VERSION) throw invalidStore();
	if (typeof value.goalId !== "string" || value.goalId.length === 0 || !Array.isArray(value.revisions)) {
		throw invalidStore();
	}
	const revisions = value.revisions.map(parseDurableGoalSnapshot);
	if (revisions.length === 0) throw invalidStore();
	for (const [index, revision] of revisions.entries()) {
		if (revision.ref.id !== value.goalId || revision.ref.revision !== index + 1) throw invalidStore();
	}
	return { schemaVersion: DURABLE_GOAL_JOURNAL_SCHEMA_VERSION, goalId: value.goalId, revisions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileSystemError(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

function invalidStore(): DurableGoalError {
	return new DurableGoalError("invalid-store", "durable goal journal is invalid");
}
