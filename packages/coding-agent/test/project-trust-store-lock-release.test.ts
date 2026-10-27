import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	projectTrustStorePath,
	readStoredProjectTrust,
	recordProjectTrustDecision,
} from "../src/core/project-trust-store.ts";

const hooks = vi.hoisted(() => ({ beforeStoreRename: undefined as (() => void) | undefined }));

// Only the final store rename is intercepted. All lock and owner-file operations stay real.
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		renameSync: (from: string, to: string) => {
			hooks.beforeStoreRename?.();
			actual.renameSync(from, to);
		},
	};
});

let home: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "omk-trust-lock-release-"));
});

afterEach(() => {
	hooks.beforeStoreRename = undefined;
	rmSync(home, { recursive: true, force: true });
});

describe("project trust store lock release", () => {
	it("does not remove a replacement owner's lock after the original holder finishes", () => {
		const lock = `${projectTrustStorePath(home)}.lock`;
		const surface = {
			projectKey: "/project",
			settingsKeys: [],
			extensionEntries: [],
			fingerprint: "fingerprint",
			overCap: false,
		};
		hooks.beforeStoreRename = () => {
			// Simulate another process reclaiming the stale lock and acquiring it with a new owner.
			writeFileSync(
				join(lock, "owner.json"),
				JSON.stringify({ pid: process.pid, host: "test-host", token: "replacement-owner" }),
			);
		};

		recordProjectTrustDecision(surface, "trusted", home);

		expect(readStoredProjectTrust("/project", home)?.decision).toBe("trusted");
		expect(statSync(lock).isDirectory()).toBe(true);
		expect(JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")).token).toBe("replacement-owner");
	});
});
