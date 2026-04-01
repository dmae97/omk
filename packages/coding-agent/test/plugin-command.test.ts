import { describe, expect, it } from "bun:test";
import type { CliConfig } from "@oh-my-pi/pi-utils/cli";
import Plugin from "../src/commands/plugin";

const TEST_CONFIG: CliConfig = {
	bin: "omp",
	version: "0.0.0-test",
	commands: new Map(),
};

describe("Plugin command scope parsing", () => {
	it("accepts project scope", async () => {
		const command = new Plugin(["install", "--scope", "project"], TEST_CONFIG);
		const { flags } = await command.parse(Plugin);
		expect(flags.scope).toBe("project");
	});

	it("rejects invalid scope values", async () => {
		const command = new Plugin(["install", "--scope", "porject"], TEST_CONFIG);
		await expect(command.parse(Plugin)).rejects.toThrow(/Expected --scope to be one of: user, project/);
	});
});
