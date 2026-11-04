import { EventEmitter } from "node:events";
import { type FSWatcher, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FS_WATCH_RETRY_DELAY_MS, closeWatcher, watchWithErrorHandler } from "../src/fs-watch.ts";

describe("fs watch helpers", () => {
	it("exposes the configured retry delay", () => {
		expect(FS_WATCH_RETRY_DELAY_MS).toBe(5000);
	});

	it("does nothing when no watcher is supplied", () => {
		expect(() => closeWatcher(null)).not.toThrow();
		expect(() => closeWatcher(undefined)).not.toThrow();
	});

	it("swallows errors raised while closing a watcher", () => {
		const watcher = {
			close: () => {
				throw new Error("already closed");
			},
		};

		expect(() => closeWatcher(watcher as unknown as FSWatcher)).not.toThrow();
	});

	it("reports a synchronous watch setup error and returns null", () => {
		const onError = vi.fn();
		const missingPath = join(tmpdir(), `omk-fs-watch-missing-${Date.now()}-${Math.random()}`);

		expect(watchWithErrorHandler(missingPath, () => undefined, onError)).toBeNull();
		expect(onError).toHaveBeenCalledTimes(1);
	});

	it("forwards errors emitted by an active watcher", () => {
		const directory = mkdtempSync(join(tmpdir(), "omk-fs-watch-"));
		const onError = vi.fn();
		let watcher: FSWatcher | null | undefined;

		try {
			watcher = watchWithErrorHandler(directory, () => undefined, onError);
			expect(watcher).not.toBeNull();
			(watcher as unknown as EventEmitter).emit("error", new Error("watch failed"));
			expect(onError).toHaveBeenCalledTimes(1);
		} finally {
			closeWatcher(watcher);
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
