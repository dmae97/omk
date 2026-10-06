import { lstatSync, mkdirSync, renameSync, rmdirSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { fsyncDirectorySync, writeExclusiveFileDurablySync } from "./durable-file-io.ts";
import { type DurableFileLockOwnerSnapshot, fileErrorCode } from "./durable-file-lock-owner.ts";

function isOccupiedLockPathError(error: unknown): boolean {
	const code = fileErrorCode(error);
	// ENOTDIR: something that is not a directory (for example a planted symlink)
	// occupies the lock path; rename(2) refuses it without following it.
	return code === "EEXIST" || code === "ENOTEMPTY" || code === "ENOTDIR";
}

function discardStagedLockSync(stage: string, ownerPath: (path: string) => string): void {
	try {
		unlinkSync(ownerPath(stage));
	} catch (error) {
		if (fileErrorCode(error) !== "ENOENT") throw error;
	}
	try {
		rmdirSync(stage);
	} catch (error) {
		if (fileErrorCode(error) !== "ENOENT") throw error;
	}
	fsyncDirectorySync(dirname(stage));
}

/**
 * Publish a lock directory that is never visible without its owner record.
 *
 * The owner record is written into a private staging directory first and the
 * directory is then renamed onto the lock path in one step. A process killed at
 * any instant therefore leaves either no lock or a lock whose owner can be
 * checked and reclaimed. Creating the lock directory in place and writing the
 * owner afterwards left an ownerless directory when a process died between the
 * two steps; that state is indistinguishable from a live acquisition, so every
 * later caller waited out its whole timeout and failed with
 * DurableFileLockBusyError.
 *
 * rename(2) refuses a non-empty target, so a held lock (which always contains
 * owner.json) is never replaced. An empty directory at the lock path can only be
 * an ownerless leftover from the old in-place protocol, and replacing it heals
 * that state.
 *
 * Returns the published owner snapshot, or undefined when the lock path is
 * already occupied (the stage has been discarded).
 */
export function publishStagedDurableFileLockSync(
	path: string,
	ownerPath: (path: string) => string,
	token: string,
	notADirectory: () => Error,
): DurableFileLockOwnerSnapshot | undefined {
	const stage = `${path}.stage-${token}`;
	mkdirSync(stage, { mode: 0o700 });
	try {
		const directory = lstatSync(stage, { bigint: true });
		if (!directory.isDirectory() || directory.isSymbolicLink()) throw notADirectory();
		const expectedOwner: DurableFileLockOwnerSnapshot = Object.freeze({
			owner: Object.freeze({ pid: process.pid, host: hostname(), token }),
			dev: directory.dev.toString(),
			ino: directory.ino.toString(),
		});
		writeExclusiveFileDurablySync(ownerPath(stage), Buffer.from(JSON.stringify(expectedOwner.owner), "utf8"));
		try {
			renameSync(stage, path);
			return expectedOwner;
		} catch (error) {
			if (!isOccupiedLockPathError(error)) throw error;
		}
	} catch (error) {
		try {
			discardStagedLockSync(stage, ownerPath);
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "Durable file lock creation cleanup failed");
		}
		throw error;
	}
	discardStagedLockSync(stage, ownerPath);
	return undefined;
}
