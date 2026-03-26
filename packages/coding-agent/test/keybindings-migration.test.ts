import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setKeybindings } from "@oh-my-pi/pi-tui";
import { KeybindingsManager } from "../src/config/keybindings";

describe("KeybindingsManager.create", () => {
	beforeEach(() => {
		setKeybindings(KeybindingsManager.inMemory());
	});

	afterEach(() => {
		setKeybindings(KeybindingsManager.inMemory());
	});

	it("migrates legacy keybinding names on disk during create", async () => {
		const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-keybindings-"));
		const configPath = path.join(agentDir, "keybindings.json");

		await Bun.write(
			configPath,
			`${JSON.stringify(
				{
					fork: "ctrl+f",
					selectConfirm: "enter",
					cursorUp: "ctrl+p",
					selectModelTemporary: "alt+y",
				},
				null,
				2,
			)}\n`,
		);

		try {
			const manager = KeybindingsManager.create(agentDir);
			const writtenConfig = await Bun.file(configPath).json();

			expect(manager.getKeys("app.session.fork")).toEqual(["ctrl+f"]);
			expect(manager.getKeys("tui.select.confirm")).toEqual(["enter"]);
			expect(manager.getKeys("tui.editor.cursorUp")).toEqual(["ctrl+p"]);
			expect(manager.getKeys("app.model.selectTemporary")).toEqual(["alt+y"]);
			expect(writtenConfig).toEqual({
				"app.model.selectTemporary": "alt+y",
				"app.session.fork": "ctrl+f",
				"tui.editor.cursorUp": "ctrl+p",
				"tui.select.confirm": "enter",
			});
			expect(writtenConfig).not.toHaveProperty("selectModelTemporary");
		} finally {
			await fs.rm(agentDir, { recursive: true, force: true });
		}
	});
});
