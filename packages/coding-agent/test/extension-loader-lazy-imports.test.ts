import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Counts how often each heavy module is evaluated. A static import in loader.ts
// would evaluate it as soon as the loader module itself is imported.
const loads = vi.hoisted(() => ({ jiti: 0 }));

vi.mock("jiti/static", async (importOriginal) => {
	loads.jiti++;
	return importOriginal();
});

describe("extension loader lazy imports", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-ext-lazy-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("does not load jiti until an extension file is loaded", async () => {
		const { discoverAndLoadExtensions, loadExtensions } = await import("../src/core/extensions/loader.ts");
		expect(loads.jiti).toBe(0);

		const empty = await loadExtensions([], tempDir);
		expect(empty.errors).toHaveLength(0);
		expect(loads.jiti).toBe(0);

		const extensionsDir = path.join(tempDir, "extensions");
		fs.mkdirSync(extensionsDir);
		const code = 'export default function (api) { api.registerCommand("lazy", { handler: async () => {} }); }\n';
		fs.writeFileSync(path.join(extensionsDir, "a.ts"), code);
		fs.writeFileSync(path.join(extensionsDir, "b.ts"), code);

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);
		expect(result.errors).toHaveLength(0);
		expect(result.extensions).toHaveLength(2);
		expect(loads.jiti).toBe(1);
	});
});
