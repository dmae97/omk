import { describe, expect, it } from "vitest";
import { runSdkSessionCli } from "../src/commands/sdk-session-cli.ts";

describe("explicit live session CLI", () => {
	it("fails a missing live endpoint without opening or appending a transcript", async () => {
		const output: string[] = [];
		let opened = false;
		const result = await runSdkSessionCli(["sdk", "session", "send", "live-fixture", "hello", "--live"], {
			writeLine: (text) => output.push(text),
			listSessions: async () => [
				{
					id: "live-fixture",
					path: "/missing-live-fixture/session.jsonl",
					cwd: "/fixture",
					created: new Date(0),
					modified: new Date(0),
					messageCount: 0,
					firstMessage: "",
					allMessagesText: "",
				},
			],
			openSession: () => {
				opened = true;
				throw new Error("must not open");
			},
		});
		expect(result).toEqual({ handled: true, exitCode: 1 });
		expect(opened).toBe(false);
		expect(output.join("\n")).toContain("live endpoint unavailable");
	});
});
