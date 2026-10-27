import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";

// Another OMK session holds auth.json.lock as a plain directory (proper-lockfile's format). An async
// holder (OAuth refresh) uses a 30 s stale window and refreshes the directory mtime every 15 s, so a
// live holder's lock can look up to 15 s old. A sync reader with a shorter stale window took that live
// lock, and so did any reader after a WSL2 wall-clock step of more than 10 s.
describe("auth storage lock staleness", () => {
	let dir: string;
	let authPath: string;
	let lockDir: string;

	beforeEach(() => {
		dir = join(tmpdir(), `omk-auth-lock-stale-${process.pid}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		authPath = join(dir, "auth.json");
		lockDir = `${authPath}.lock`;
		writeFileSync(
			authPath,
			JSON.stringify({
				anthropic: { type: "oauth", refresh: "r", access: "stored-access-token", expires: Date.now() + 3_600_000 },
			}),
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(dir, { recursive: true, force: true });
	});

	function holdLock(ageMs: number): void {
		mkdirSync(lockDir);
		const mtime = new Date(Date.now() - ageMs);
		utimesSync(lockDir, mtime, mtime);
	}

	it.each([
		{ name: "an async holder between mtime refreshes (12 s old)", ageMs: 12_000, wallStepMs: 0 },
		{ name: "a fresh lock after a 20 s wall-clock step", ageMs: 0, wallStepMs: 20_000 },
	])("a sync read leaves $name alone", async ({ ageMs, wallStepMs }) => {
		holdLock(ageMs);
		const realNow = Date.now.bind(Date);
		vi.spyOn(Date, "now").mockImplementation(() => realNow() + wallStepMs);

		const storage = AuthStorage.create(authPath);
		const apiKey = await storage.getApiKey("anthropic");

		expect(apiKey).toBeUndefined();
		expect(storage.drainErrors().some((error) => (error as { code?: string }).code === "ELOCKED")).toBe(true);
		expect(existsSync(lockDir)).toBe(true);
	});

	it("still reclaims a lock abandoned past the stale window", async () => {
		holdLock(31_000);

		const storage = AuthStorage.create(authPath);

		expect(await storage.getApiKey("anthropic")).toBe("stored-access-token");
		expect(existsSync(lockDir)).toBe(false);
	});
});
