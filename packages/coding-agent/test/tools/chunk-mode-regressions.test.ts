import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { _resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EditTool } from "@oh-my-pi/pi-coding-agent/edit";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";

const FIXTURE_DIR = path.join(import.meta.dir, "..", "fixtures");

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter(block => block.type === "text")
		.map(block => block.text ?? "")
		.join("\n");
}

function createSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
	};
}

async function readFixture(name: string): Promise<string> {
	return Bun.file(path.join(FIXTURE_DIR, name)).text();
}

function extractSelector(readText: string, prefix: string): string {
	const match = new RegExp(`(${prefix.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}#[A-Z]{4})`).exec(readText);
	if (!match) {
		throw new Error(`missing selector for ${prefix}`);
	}
	return match[1];
}

describe("chunk mode regression coverage", () => {
	let tmpDir: string;
	let originalEditVariant: string | undefined;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chunk-mode-regression-"));
		_resetSettingsForTest();
		await Settings.init({ inMemory: true, cwd: tmpDir });
		originalEditVariant = Bun.env.PI_EDIT_VARIANT;
		Bun.env.PI_EDIT_VARIANT = "chunk";
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		_resetSettingsForTest();
		if (originalEditVariant === undefined) {
			delete Bun.env.PI_EDIT_VARIANT;
		} else {
			Bun.env.PI_EDIT_VARIANT = originalEditVariant;
		}
	});

	it("uses the Rust fixture through the real chunk-edit path", async () => {
		const fixtureName = "chunk-edit-indent.rs";
		const filePath = path.join(tmpDir, fixtureName);
		await Bun.write(filePath, await readFixture(fixtureName));
		const session = createSession(tmpDir);
		const readTool = new ReadTool(session);
		const editTool = new EditTool(session);

		const beforeRead = getText(
			await readTool.execute("chunk-read-rust", { path: `${filePath}:impl_Greete.fn_render` }),
		);
		const selector = extractSelector(beforeRead, "impl_Greete.fn_render");

		await editTool.execute("chunk-edit-rust-body", {
			path: filePath,
			edits: [
				{
					sel: `${selector}~`,
					op: "replace",
					content: 'let greeting = format!("Hello, {name}");\nprintln!("{greeting}");\ngreeting\n',
				},
			],
		} as never);

		const updatedSource = await Bun.file(filePath).text();
		expect(updatedSource).toContain('        let greeting = format!("Hello, {name}");');
		expect(updatedSource).toContain('        println!("{greeting}");');
		expect(updatedSource).not.toContain('\n    let greeting = format!("Hello, {name}");');
	});

	it("preserves the blank line before the next markdown section on after", async () => {
		const filePath = path.join(tmpDir, "spacing-after.md");
		await Bun.write(filePath, "# Title\n\n## Alpha\n\nalpha body\n\n## Beta\n\nbeta body\n");
		const session = createSession(tmpDir);
		const readTool = new ReadTool(session);
		const editTool = new EditTool(session);

		const beforeRead = getText(await readTool.execute("chunk-read-markdown-after", { path: filePath }));
		const selector = extractSelector(beforeRead, "sect_Title.sect_Alpha");

		await editTool.execute("chunk-edit-markdown-after", {
			path: filePath,
			edits: [
				{
					sel: selector,
					op: "after",
					content: "## Inserted\n\ninserted body\n",
				},
			],
		} as never);

		const updatedSource = await Bun.file(filePath).text();
		expect(updatedSource).toContain("## Inserted\n\ninserted body\n\n## Beta");
		expect(updatedSource).not.toContain("## Inserted\n\ninserted body\n## Beta");
	});

	it("preserves the blank line before the next markdown section on ~.append", async () => {
		const filePath = path.join(tmpDir, "spacing-append.md");
		await Bun.write(filePath, "# Title\n\n## Alpha\n\nalpha body\n\n## Beta\n\nbeta body\n");
		const session = createSession(tmpDir);
		const readTool = new ReadTool(session);
		const editTool = new EditTool(session);

		const beforeRead = getText(await readTool.execute("chunk-read-markdown-append", { path: filePath }));
		const selector = extractSelector(beforeRead, "sect_Title.sect_Alpha");

		await editTool.execute("chunk-edit-markdown-append", {
			path: filePath,
			edits: [
				{
					sel: `${selector}~`,
					op: "append",
					content: "\nextra paragraph\n",
				},
			],
		} as never);

		const updatedSource = await Bun.file(filePath).text();
		expect(updatedSource).toContain("alpha body\n\n    extra paragraph\n\n## Beta");
		expect(updatedSource).not.toContain("alpha body\n\n    extra paragraph\n## Beta");
	});
});
