import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	changedDeliverables,
	FINISH_CHECK_REVERIFY_MAX_HASH_BYTES,
	hashDeliverables,
} from "../src/core/finish-check-reverify-hash.ts";

// spec 032: deliverables are hashed before and after the verifier; a change makes the verification void.

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
	const dir = mkdtempSync(join(tmpdir(), "omk-reverify-hash-"));
	dirs.push(dir);
	return dir;
}

describe("finish-check reverify: deliverable hashes", () => {
	it("records size and sha256, resolves relative paths against cwd, and marks missing files", async () => {
		const cwd = workspace();
		writeFileSync(join(cwd, "out.txt"), "hello");
		mkdirSync(join(cwd, "dir"));
		const hashes = await hashDeliverables(["out.txt", join(cwd, "gone.txt"), "dir"], cwd);
		expect(hashes["out.txt"]).toBe("5:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
		expect(hashes[join(cwd, "gone.txt")]).toBe("missing");
		expect(hashes.dir).toBe("directory");
	});

	it("reports exactly the paths whose content, presence or size changed", async () => {
		const cwd = workspace();
		writeFileSync(join(cwd, "a.txt"), "a");
		writeFileSync(join(cwd, "b.txt"), "b");
		const before = await hashDeliverables(["a.txt", "b.txt", "c.txt"], cwd);
		writeFileSync(join(cwd, "a.txt"), "A");
		writeFileSync(join(cwd, "c.txt"), "new");
		const after = await hashDeliverables(["a.txt", "b.txt", "c.txt"], cwd);
		expect(changedDeliverables(before, after)).toEqual(["a.txt", "c.txt"]);
		expect(changedDeliverables(before, before)).toEqual([]);
	});

	it("does not read files over the size limit and compares them by size only", async () => {
		const cwd = workspace();
		writeFileSync(join(cwd, "big.bin"), "0123456789");
		expect(await hashDeliverables(["big.bin"], cwd, 4)).toEqual({ "big.bin": "10:too-large" });
	});

	it("compares files over 8 MiB by size only by default", async () => {
		const cwd = workspace();
		const size = 8 * 1024 * 1024 + 1;
		writeFileSync(join(cwd, "big.bin"), "");
		truncateSync(join(cwd, "big.bin"), size);
		expect(FINISH_CHECK_REVERIFY_MAX_HASH_BYTES).toBe(8 * 1024 * 1024);
		expect(await hashDeliverables(["big.bin"], cwd)).toEqual({ "big.bin": `${size}:too-large` });
	});
});
