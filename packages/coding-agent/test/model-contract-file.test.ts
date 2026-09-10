import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadModelContract } from "../src/cli/model-contract.ts";

const directories: string[] = [];
afterEach(() => {
	for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
const policy = {
	allowedModels: [{ provider: "fixture", id: "model" }],
	allowedProviders: ["fixture"],
	allowedAuthOrigins: ["fixture"],
	thinking: false,
	thinkingLevel: "off",
	maxOutputTokens: 512,
};
function file(content: string | Uint8Array) {
	const directory = mkdtempSync(join(tmpdir(), "omk-contract-file-"));
	directories.push(directory);
	const path = join(directory, "policy.json");
	writeFileSync(path, content);
	return path;
}

describe("CLI model contract file boundary", () => {
	it("returns an immutable policy independent of later file changes", () => {
		const path = file(JSON.stringify(policy));
		const parsed = loadModelContract(path);
		writeFileSync(path, "{}");
		expect(parsed).toEqual(policy);
		expect(Object.isFrozen(parsed)).toBe(true);
	});

	it("accepts an exactly 64 KiB regular file", () => {
		const content = JSON.stringify(policy).padEnd(64 * 1024, " ");
		expect(loadModelContract(file(content))).toEqual(policy);
	});

	it.each(["{fixture-private-invalid-json", "{}", "null", " ".repeat(64 * 1024 + 1)])(
		"rejects invalid or oversized content",
		(content) => {
			const path = file(content);
			expect(() => loadModelContract(path)).toThrow();
			expect(() => loadModelContract(path)).not.toThrow(/fixture-private-invalid-json/);
		},
	);

	it("rejects invalid UTF-8 rather than replacing bytes", () => {
		expect(() => loadModelContract(file(new Uint8Array([0xff, 0xfe])))).toThrow(/UTF-8/);
	});

	it("rejects a directory or absent file with a bounded message", () => {
		file("{}");
		const directory = directories[0];
		if (directory === undefined) throw new Error("Missing fixture directory");
		expect(() => loadModelContract(directory)).toThrow(/regular file/);
		expect(() => loadModelContract(join(directory, "absent"))).toThrow(/regular file/);
	});
});
