import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EditTool } from "@oh-my-pi/pi-coding-agent/patch";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { Snowflake } from "@oh-my-pi/pi-utils";

function createTestToolSession(cwd: string, settings: Settings = Settings.isolated()): ToolSession {
	const sessionFile = path.join(cwd, "session.jsonl");
	const sessionDir = path.join(cwd, "session");
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => sessionFile,
		getSessionSpawns: () => "*",
		getArtifactsDir: () => sessionDir,
		allocateOutputArtifact: async (toolType: string) => {
			fs.mkdirSync(sessionDir, { recursive: true });
			return {
				id: `${toolType}-${Snowflake.next()}`,
				path: path.join(sessionDir, `${toolType}-${Snowflake.next()}.log`),
			};
		},
		settings,
	};
}

function getTextOutput(result: { content?: Array<{ type: string; text?: string }> }): string {
	return (
		result.content
			?.filter(block => block.type === "text")
			.map(block => block.text ?? "")
			.join("\n") ?? ""
	);
}

function getSchemaProperties(tool: EditTool): Record<string, unknown> {
	const schema = tool.parameters as unknown as { properties?: Record<string, unknown> };
	return schema.properties ?? {};
}

describe("EditTool import management integration", () => {
	let tempDir: string;
	let originalEditVariant: string | undefined;

	beforeEach(() => {
		originalEditVariant = Bun.env.PI_EDIT_VARIANT;
		Bun.env.PI_EDIT_VARIANT = "replace";
		tempDir = path.join(os.tmpdir(), `coding-agent-imports-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		if (originalEditVariant === undefined) {
			delete Bun.env.PI_EDIT_VARIANT;
		} else {
			Bun.env.PI_EDIT_VARIANT = originalEditVariant;
		}
	});

	it("applies a textual edit and then manages imports in replace mode", async () => {
		const filePath = path.join(tempDir, "main.go");
		fs.writeFileSync(filePath, ["package main", "", "func main() {", '\tprintln("old")', "}", ""].join("\n"));

		const tool = new EditTool(createTestToolSession(tempDir, Settings.isolated({ "edit.manageImports": true })));
		const result = await tool.execute("replace-go-imports", {
			path: filePath,
			old_text: 'println("old")',
			new_text: 'fmt.Println("new")',
			imports: [{ from: "fmt" }],
		});

		expect(getTextOutput(result)).toContain("Successfully replaced");
		expect(await Bun.file(filePath).text()).toBe(
			["package main", "", 'import "fmt"', "", "func main() {", '\tfmt.Println("new")', "}", ""].join("\n"),
		);
	});
	it("omits imports from prompts and schemas when the setting is disabled", () => {
		const tool = new EditTool(createTestToolSession(tempDir, Settings.isolated({ "edit.manageImports": false })));

		expect(tool.description).not.toContain("`imports`");
		expect(getSchemaProperties(tool)).not.toHaveProperty("imports");
	});

	it("ignores import requests when the setting is disabled", async () => {
		const filePath = path.join(tempDir, "main.go");
		fs.writeFileSync(filePath, ["package main", "", "func main() {", '\tprintln("old")', "}", ""].join("\n"));

		const tool = new EditTool(createTestToolSession(tempDir, Settings.isolated({ "edit.manageImports": false })));
		await tool.execute("replace-go-imports-disabled", {
			path: filePath,
			old_text: 'println("old")',
			new_text: 'fmt.Println("new")',
			imports: [{ from: "fmt" }],
		});

		expect(await Bun.file(filePath).text()).toBe(
			["package main", "", "func main() {", '\tfmt.Println("new")', "}", ""].join("\n"),
		);
	});

	it("includes imports in prompts and schemas when the setting is enabled", () => {
		const tool = new EditTool(createTestToolSession(tempDir, Settings.isolated({ "edit.manageImports": true })));

		expect(tool.description).toContain("`imports`");
		expect(getSchemaProperties(tool)).toHaveProperty("imports");
	});
});
