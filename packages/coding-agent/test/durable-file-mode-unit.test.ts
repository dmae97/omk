import { chmodSync, closeSync, mkdtempSync, openSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DurableFileModeError,
	enforcePrivateFileDescriptorModeSync,
	enforcePrivateFileModeSync,
} from "../src/core/durable-file-mode.ts";

const modeOf = (path: string): number => statSync(path).mode & 0o7777;

describe.skipIf(process.platform === "win32")("durable file mode", () => {
	let dir: string;
	let file: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "omk-durable-file-mode-"));
		file = join(dir, "secret.json");
		writeFileSync(file, "{}");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	describe("enforcePrivateFileModeSync", () => {
		it("narrows a 0644 file to 0600", () => {
			chmodSync(file, 0o644);
			enforcePrivateFileModeSync(file);
			expect(modeOf(file)).toBe(0o600);
		});

		it("leaves a file already at 0600 untouched", () => {
			chmodSync(file, 0o600);
			const before = statSync(file).ctimeMs;
			enforcePrivateFileModeSync(file);
			expect(modeOf(file)).toBe(0o600);
			// No chmod happened: a chmod updates the inode change time.
			expect(statSync(file).ctimeMs).toBe(before);
		});

		it("throws the open error for a missing path", () => {
			const missing = join(dir, "missing.json");
			expect(() => enforcePrivateFileModeSync(missing)).toThrow(expect.objectContaining({ code: "ENOENT" }));
			expect(() => enforcePrivateFileModeSync(missing)).not.toThrow(DurableFileModeError);
		});
	});

	describe("enforcePrivateFileDescriptorModeSync", () => {
		it("narrows the file behind an open descriptor", () => {
			chmodSync(file, 0o644);
			const fd = openSync(file, "r");
			try {
				enforcePrivateFileDescriptorModeSync(fd, file);
			} finally {
				closeSync(fd);
			}
			expect(modeOf(file)).toBe(0o600);
		});

		it("wraps a failure, such as a closed descriptor, in DurableFileModeError", () => {
			const fd = openSync(file, "r");
			closeSync(fd);
			let caught: unknown;
			try {
				enforcePrivateFileDescriptorModeSync(fd, file);
			} catch (error) {
				caught = error;
			}
			expect(caught).toBeInstanceOf(DurableFileModeError);
			const error = caught as DurableFileModeError;
			expect(error.name).toBe("DurableFileModeError");
			expect(error.path).toBe(file);
			expect(error.message).toContain("Cannot enforce private mode 0600");
			expect(error.message).toContain(file);
			expect(error.message).toContain("(EBADF)");
			expect(error.cause).toEqual(expect.objectContaining({ code: "EBADF" }));
		});
	});
});
