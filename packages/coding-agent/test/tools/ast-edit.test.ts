import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { adaptSchemaForStrict } from "@oh-my-pi/pi-ai/utils/schema";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createTools, type ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { PendingActionStore } from "@oh-my-pi/pi-coding-agent/tools/pending-action";

function createTestSession(cwd = "/tmp/test", overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd,
		hasUI: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		...overrides,
	};
}

function asSchemaObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Expected object schema");
	}
	return value as Record<string, unknown>;
}

describe("ast_edit tool schema", () => {
	it("uses op entries as [{ pat, out }]", async () => {
		const tools = await createTools(createTestSession());
		const tool = tools.find(entry => entry.name === "ast_edit");
		expect(tool).toBeDefined();
		const schema = asSchemaObject(tool?.parameters);
		const properties = asSchemaObject(schema.properties);
		const ops = asSchemaObject(properties.ops);

		expect(ops.type).toBe("array");
		const items = asSchemaObject(ops.items);
		expect(items.type).toBe("object");
		expect(items.required).toEqual(["pat", "out"]);
		const itemProperties = asSchemaObject(items.properties);
		expect(asSchemaObject(itemProperties.pat).type).toBe("string");
		expect(asSchemaObject(itemProperties.out).type).toBe("string");
		expect(properties.preview).toBeUndefined();
	});

	it("remains strict-representable after strict adaptation", async () => {
		const tools = await createTools(createTestSession());
		const tool = tools.find(entry => entry.name === "ast_edit");
		expect(tool).toBeDefined();
		const schema = asSchemaObject(tool?.parameters);

		const strict = adaptSchemaForStrict(schema, true);
		expect(strict.strict).toBe(true);
	});

	it("renders +/- lines with aligned hashline prefixes", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-edit-render-"));
		try {
			const filePath = path.join(tempDir, "legacy.ts");
			await Bun.write(filePath, "legacyWrap(x, value)\n");

			const tools = await createTools(createTestSession(tempDir));
			const tool = tools.find(entry => entry.name === "ast_edit");
			expect(tool).toBeDefined();

			const result = await tool!.execute("ast-edit-test", {
				ops: [{ pat: "legacyWrap($A, $B)", out: "modernWrap($A, $B)" }],
				lang: "typescript",
				path: filePath,
			});
			const text = result.content.find(content => content.type === "text")?.text ?? "";
			const lines = text.split("\n");
			const removedLine = lines.find(line => line.startsWith("-"));
			const addedLine = lines.find(line => line.startsWith("+"));

			expect(removedLine).toBeDefined();
			expect(addedLine).toBeDefined();
			expect(removedLine).toMatch(/^-\d+#\w+:/);
			expect(addedLine).toMatch(/^\+\d+#\w+:/);
			expect(removedLine?.split(":", 1)[0].length).toBe(addedLine?.split(":", 1)[0].length);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("registers a pending action that apply writes changes", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-edit-pending-"));
		try {
			const filePath = path.join(tempDir, "legacy.ts");
			await Bun.write(filePath, "legacyWrap(x, value)\n");
			const pendingActionStore = new PendingActionStore();

			const tools = await createTools(createTestSession(tempDir, { pendingActionStore }));
			const tool = tools.find(entry => entry.name === "ast_edit");
			expect(tool).toBeDefined();

			const previewResult = await tool!.execute("ast-edit-preview", {
				ops: [{ pat: "legacyWrap($A, $B)", out: "modernWrap($A, $B)" }],
				lang: "typescript",
				path: filePath,
			});
			expect(previewResult.details).toBeDefined();
			expect((previewResult.details as { applied?: boolean }).applied).toBe(false);

			const pending = pendingActionStore.peek();
			expect(pending).not.toBeNull();
			if (!pending) throw new Error("Expected pending action to be registered");
			expect(pending.sourceToolName).toBe("ast_edit");

			await pending.apply("apply previewed AST edit");
			const updated = await Bun.file(filePath).text();
			expect(updated).toContain("modernWrap(x, value)");
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("combines globbing from path and glob parameters", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-edit-glob-"));
		try {
			const packagesDir = path.join(tempDir, "packages");
			const sourceDir = path.join(packagesDir, "pkg-123", "src");
			const nestedDir = path.join(sourceDir, "nested");
			await fs.mkdir(nestedDir, { recursive: true });
			await Bun.write(path.join(sourceDir, "root.ts"), "legacyWrap(rootValue, rootArg)\n");
			await Bun.write(path.join(nestedDir, "child.ts"), "legacyWrap(childValue, childArg)\n");
			await Bun.write(path.join(sourceDir, "ignore.js"), "legacyWrap(ignoreValue, ignoreArg)\n");
			await Bun.write(path.join(tempDir, "outside.ts"), "legacyWrap(outsideValue, outsideArg)\n");
			const pendingActionStore = new PendingActionStore();

			const tools = await createTools(createTestSession(tempDir, { pendingActionStore }));
			const tool = tools.find(entry => entry.name === "ast_edit");
			expect(tool).toBeDefined();

			const previewResult = await tool!.execute("ast-edit-glob", {
				ops: [{ pat: "legacyWrap($A, $B)", out: "modernWrap($A, $B)" }],
				lang: "typescript",
				path: `${packagesDir}/pkg-*/src`,
				glob: "**/*.ts",
			});

			const text = previewResult.content.find(content => content.type === "text")?.text ?? "";
			const details = previewResult.details as { totalReplacements?: number; fileReplacements?: Array<{ path: string; count: number }> } | undefined;

			expect(text).toContain("## └─ root.ts (1 replacement)");
			expect(text).toContain("## └─ child.ts (1 replacement)");
			expect(text).not.toContain("ignore.js");
			expect(text).not.toContain("outside.ts");
			expect(details?.totalReplacements).toBe(2);
			expect(details?.fileReplacements).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ path: "pkg-123/src/root.ts", count: 1 }),
					expect.objectContaining({ path: "pkg-123/src/nested/child.ts", count: 1 }),
				]),
			);

			const pending = pendingActionStore.peek();
			expect(pending).not.toBeNull();
			if (!pending) throw new Error("Expected pending action to be registered");
			await pending.apply("apply previewed AST edit with combined globs");

			expect(await Bun.file(path.join(sourceDir, "root.ts")).text()).toContain("modernWrap(rootValue, rootArg)");
			expect(await Bun.file(path.join(nestedDir, "child.ts")).text()).toContain("modernWrap(childValue, childArg)");
			expect(await Bun.file(path.join(sourceDir, "ignore.js")).text()).toContain("legacyWrap(ignoreValue, ignoreArg)");
			expect(await Bun.file(path.join(tempDir, "outside.ts")).text()).toContain("legacyWrap(outsideValue, outsideArg)");
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
