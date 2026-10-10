import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBashTool } from "../src/core/tools/bash.ts";

const executable = process.env.RTK_TEST_EXECUTABLE;
const paths = new Set<string>();
afterEach(() => {
	vi.unstubAllEnvs();
	for (const path of paths) rmSync(path, { recursive: true, force: true });
	paths.clear();
});

describe.skipIf(!executable)("installed RTK public bash integration", () => {
	it("executes real Vitest once and filters its success while preserving the raw log", async () => {
		const root = mkdtempSync(join(tmpdir(), "omk-rtk-live-"));
		paths.add(root);
		mkdirSync(join(root, "test"));
		symlinkSync(resolve("../../node_modules"), join(root, "node_modules"), "dir");
		const cases = Array.from(
			{ length: 30 },
			(_, index) =>
				`it('preserves a real arithmetic assertion in scenario ${index}', () => expect(${index} + 1).toBe(${index + 1}));`,
		).join("\n");
		writeFileSync(join(root, "test", "sample.test.mjs"), `import { expect, it } from 'vitest';\n${cases}`);
		// Resolve the already-installed dependency, never install inside a test.
		writeFileSync(
			join(root, "vitest.config.mjs"),
			`export default { test: { include: ['test/sample.test.mjs'], maxWorkers: 1, fileParallelism: false } };`,
		);
		vi.stubEnv("OMK_RTK_OUTPUT", "1");
		vi.stubEnv("OMK_RTK_PATH", executable ?? "rtk");
		const cli = resolve("../../node_modules/vitest/dist/cli.js");
		const result = await createBashTool(root).execute("live", {
			command: `node ${cli} --run --root ${root} --reporter=verbose`,
		});
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		const rawPath = text.match(/Full output: ([^\]\n]+)/)?.[1];
		expect(rawPath).toBeDefined();
		if (!rawPath) throw new Error("Expected raw log");
		paths.add(rawPath);
		const raw = readFileSync(rawPath, "utf8");
		expect(raw).toContain("30 passed");
		expect(raw).toContain("scenario 29");
		expect(text).toContain("PASS (30)");
		expect(text).not.toContain("scenario 29");
	});

	it("keeps real TypeScript short-option help raw rather than claiming compilation success", async () => {
		const root = mkdtempSync(join(tmpdir(), "omk-rtk-help-"));
		paths.add(root);
		vi.stubEnv("OMK_RTK_OUTPUT", "1");
		vi.stubEnv("OMK_RTK_PATH", executable ?? "rtk");
		const cli = resolve("../../node_modules/typescript/bin/tsc");
		const result = await createBashTool(root).execute("help", { command: `node ${cli} --noEmit -h` });
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		const rawPath = text.match(/Full output: ([^\]\n]+)/)?.[1];
		if (rawPath) paths.add(rawPath);
		expect(text).toContain("COMMON COMMANDS");
		expect(text).not.toContain("TypeScript compilation completed");
		expect(result.details).toBeUndefined();
	});
});
