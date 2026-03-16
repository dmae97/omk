import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { getSessionsDir, Snowflake } from "@oh-my-pi/pi-utils";

describe("createAgentSession session storage isolation", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("uses the provided agentDir for the default persistent session root", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `pi-sdk-session-isolation-${Snowflake.next()}-`));
		tempDirs.push(tempDir);
		const cwd = path.join(tempDir, `project-${Snowflake.next()}`);
		const agentDir = path.join(tempDir, "agent");
		fs.mkdirSync(cwd, { recursive: true });

		const { session } = await createAgentSession({
			cwd,
			agentDir,
			settings: Settings.isolated(),
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
		});

		try {
			const sessionFile = session.sessionFile;
			if (!sessionFile) {
				throw new Error("Expected session file path");
			}

			expect(sessionFile.startsWith(path.join(agentDir, "sessions"))).toBe(true);
			expect(sessionFile.startsWith(getSessionsDir())).toBe(false);
		} finally {
			await session.dispose();
		}
	});
});
