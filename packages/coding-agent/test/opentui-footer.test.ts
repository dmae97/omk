import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { visibleWidth } from "omk-tui";
import { describe, expect, it } from "vitest";
import { ansiToSpans, type FooterPanelModel, xterm256 } from "../src/modes/interactive/opentui-footer-model.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("ansiToSpans", () => {
	it("keeps foreground color and bold, merges equal runs and drops other escapes", () => {
		const line = `\x1b[38;2;10;20;30mdim \x1b]8;;https://x\x07link\x1b]8;;\x07\x1b[39m plain \x1b[1m\x1b[38;5;196mhot\x1b[22m\x1b[0m!`;
		expect(ansiToSpans(line)).toEqual([
			{ text: "dim link", color: "#0a141e" },
			{ text: " plain ", color: undefined },
			{ text: "hot", color: "#ff0000", bold: true },
			{ text: "!", color: undefined },
		]);
	});

	it("maps the xterm 256 palette", () => {
		expect([xterm256(1), xterm256(16), xterm256(231), xterm256(244)]).toEqual([
			"#cd0000",
			"#000000",
			"#ffffff",
			"#808080",
		]);
	});
});

const supported = Number(process.versions.node.split(".")[0]) >= 26;

describe.skipIf(!supported)("real OpenTUI footer worker", () => {
	it("pins the right side to the right edge and keeps span colors", async () => {
		const child = fork(
			fileURLToPath(new URL("../src/modes/interactive/opentui-status-worker.ts", import.meta.url)),
			[],
			{ execArgv: ["--experimental-ffi"], stdio: ["ignore", "pipe", "pipe", "ipc"] },
		);
		let stdout = "";
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
		const model: FooterPanelModel = {
			text: "#ede6d6",
			lines: [
				{ left: [{ text: "~/작업 (main)", color: "#7f7f7f" }], right: [] },
				{
					left: [
						{ text: "↑1.2k ", color: "#7f7f7f" },
						{ text: "71.0%/200k", color: "#e8564c" },
					],
					right: [{ text: "gpt-6 • high", color: "#7f7f7f" }],
				},
			],
		};
		try {
			const reply = new Promise<{ id: number; lines: string[] }>((resolve) =>
				child.once("message", (message) => resolve(message as { id: number; lines: string[] })),
			);
			child.send({ id: 1, kind: "footer", width: 60, height: 2, model });
			const { id, lines } = await reply;
			expect(id).toBe(1);
			expect(lines).toHaveLength(2);
			const plain = lines.map(stripAnsi);
			expect(plain[0]!.trimEnd()).toBe("~/작업 (main)");
			expect(plain[1]!.startsWith("↑1.2k 71.0%/200k")).toBe(true);
			expect(plain[1]!.endsWith("gpt-6 • high")).toBe(true);
			expect(lines.every((line) => visibleWidth(line) === 60)).toBe(true);
			expect(lines[1]).toContain("\x1b[38;2;232;86;76m71.0%/200k");
			// Footer rows carry no background and no terminal control sequences.
			expect(lines.join("")).not.toMatch(/\x1b\[48;|\x1b\[\?|\x1b\[[0-9;]*[HJK]/);
			expect(stdout).toBe("");
		} finally {
			child.kill("SIGTERM");
			await closed;
		}
	}, 15000);
});
