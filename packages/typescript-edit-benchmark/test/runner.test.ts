import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { formatSessionDumpText, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { TempDir } from "@oh-my-pi/pi-utils";
import { writeConversationDump } from "../src/runner";

const tempDirs: TempDir[] = [];

async function createTempDir(prefix: string): Promise<TempDir> {
	const dir = await TempDir.create(prefix);
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map(async dir => {
			await dir.remove();
		}),
	);
});

describe("writeConversationDump", () => {
	it("writes benchmark conversations as session dumps and copies artifacts", async () => {
		const sourceRoot = await createTempDir("@typescript-edit-benchmark-source-");
		const dumpRoot = await createTempDir("@typescript-edit-benchmark-dump-");
		const sourceWorkDir = sourceRoot.join("worktree");
		const sourceSessionDir = sourceRoot.join("sessions");
		await fs.mkdir(sourceWorkDir, { recursive: true });
		await fs.mkdir(sourceSessionDir, { recursive: true });

		const sourceSession = SessionManager.create(sourceWorkDir, sourceSessionDir);
		const userMessage: AgentMessage = {
			role: "user",
			content: [{ type: "text", text: "Fix the failing benchmark." }],
			attribution: "user",
			timestamp: Date.now(),
		};
		sourceSession.appendMessage(userMessage);
		await sourceSession.ensureOnDisk();
		const artifactId = await sourceSession.saveArtifact("artifact contents", "read");
		await sourceSession.flush();
		await sourceSession.close();

		const sourceSessionFile = sourceSession.getSessionFile();
		if (!sourceSessionFile || !artifactId) {
			throw new Error("Test fixture failed to create source session dump");
		}
		const sourceArtifactPath = await sourceSession.getArtifactPath(artifactId);
		if (!sourceArtifactPath) {
			throw new Error("Test fixture failed to resolve source artifact path");
		}

		const dumpPath = await writeConversationDump({
			dumpDir: dumpRoot.absolute(),
			taskId: "task/weird",
			runIndex: 0,
			snapshot: {
				messages: [userMessage],
				sourceSessionFile,
			},
		});

		expect(dumpPath).toBe(path.join(dumpRoot.absolute(), "task_weird", "run-1.md"));

		const dumpText = await Bun.file(dumpPath).text();
		const expectedBody = formatSessionDumpText({ messages: [userMessage] });
		expect(dumpText.trim()).toBe(expectedBody.trim());

		const copiedArtifactPath = path.join(dumpPath.slice(0, -3), path.basename(sourceArtifactPath));
		expect(await Bun.file(copiedArtifactPath).text()).toBe("artifact contents");
	});
});
