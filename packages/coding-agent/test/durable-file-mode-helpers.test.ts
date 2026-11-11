import {
	chmodSync,
	closeSync,
	fstatSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DurableFileModeError,
	enforcePrivateFileDescriptorModeSync,
	enforcePrivateFileModeSync,
} from "../src/core/durable-file-mode.ts";

const modeOf = (path: string): number => statSync(path).mode & 0o7777;

describe.skipIf(process.platform === "win32")("durable file mode helpers", () => {
	let dir: string;
	let file: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "omk-durable-file-mode-"));
		file = join(dir, "secret.json");
		writeFileSync(file, "hello durable mode", { mode: 0o644 });
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

		it("leaves a file already at 0600 untouched without updating ctime", () => {
			chmodSync(file, 0o600);
			const before = statSync(file).ctimeMs;
			enforcePrivateFileModeSync(file);
			expect(modeOf(file)).toBe(0o600);
			expect(statSync(file).ctimeMs).toBe(before);
		});

		it("throws the openSync error for a missing path without wrapping", () => {
			const missing = join(dir, "missing.json");
			expect(() => enforcePrivateFileModeSync(missing)).toThrow(expect.objectContaining({ code: "ENOENT" }));
			expect(() => enforcePrivateFileModeSync(missing)).not.toThrow(DurableFileModeError);
		});

		it("is idempotent when run repeatedly", () => {
			expect(() => enforcePrivateFileModeSync(file)).not.toThrow();
			expect(() => enforcePrivateFileModeSync(file)).not.toThrow();
			expect(modeOf(file)).toBe(0o600);
		});

		it("preserves file content when enforcing mode", () => {
			const beforeContent = readFileSync(file, "utf8");
			enforcePrivateFileModeSync(file);
			expect(readFileSync(file, "utf8")).toBe(beforeContent);
			expect(modeOf(file)).toBe(0o600);
		});
	});

	describe("enforcePrivateFileDescriptorModeSync", () => {
		it("narrows the file behind an open descriptor from 0644 to 0600", () => {
			chmodSync(file, 0o644);
			const fd = openSync(file, "r");
			try {
				enforcePrivateFileDescriptorModeSync(fd, file);
				expect(fstatSync(fd).mode & 0o7777).toBe(0o600);
			} finally {
				closeSync(fd);
			}
			expect(modeOf(file)).toBe(0o600);
		});

		it("returns early when descriptor mode is already 0600", () => {
			chmodSync(file, 0o600);
			const fd = openSync(file, "r");
			try {
				const beforeCtime = fstatSync(fd).ctimeMs;
				enforcePrivateFileDescriptorModeSync(fd, file);
				expect(fstatSync(fd).mode & 0o7777).toBe(0o600);
				expect(fstatSync(fd).ctimeMs).toBe(beforeCtime);
			} finally {
				closeSync(fd);
			}
		});

		it("wraps a closed descriptor failure in DurableFileModeError", () => {
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
