// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8")) as Record<string, unknown>;

describe("omk-speak-like-you-eat package", () => {
	it("declares one OMK extension and only host peer dependencies", () => {
		const manifest = json("package.json");
		expect(manifest.name).toBe("omk-speak-like-you-eat");
		expect(manifest.omk).toEqual({ extensions: ["./dist/extension.js"] });
		expect(manifest.dependencies).toBeUndefined();
		expect(Object.keys(manifest.peerDependencies as Record<string, unknown>).sort()).toEqual([
			"omk-ai",
			"omk-tui",
			"open-multi-agent-kit",
		]);
		expect(manifest.repository).toMatchObject({
			url: "git+https://github.com/dmae97/omk.git",
			directory: "packages/speak-like-you-eat",
		});
	});
	it("pins the MIT upstream snapshot and ships both license notices", () => {
		const upstream = json("upstream.json");
		expect(upstream.source).toMatchObject({
			repository: "https://github.com/wtfzambo/speak-like-you-eat",
			commit: "162d756406a02dc84873b46d04ff3907e3f5262d",
			declaredVersion: "1.6.1",
		});
		expect(upstream.license).toBe("MIT");
		expect(readFileSync(resolve(root, "UPSTREAM-LICENSE"), "utf8")).toContain("Copyright (c) 2026 wtfzambo");
		for (const path of ["README.md", "CHANGELOG.md", "LICENSE", "src/extension.ts"]) {
			expect(existsSync(resolve(root, path)), path).toBe(true);
		}
	});
});
