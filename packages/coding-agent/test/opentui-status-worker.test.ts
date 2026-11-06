import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { visibleWidth } from "omk-tui";
import { describe, expect, it } from "vitest";
import type { StatusPanelModel } from "../src/modes/interactive/status-panel-model.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const model: StatusPanelModel = {
	model: "gpt-6.1-sol",
	provider: "openai-codex / max",
	path: "~/작업/OMK",
	expanded: false,
	system: {
		cpuPercent: 82,
		memoryPercent: 75,
		memoryCaption: "12.0G / 16.0G",
		cpuColor: "#ede6d6",
		memoryColor: "#ede6d6",
	},
	rows: [
		{ label: "Run", value: "✓ idle", color: "#5fb384" },
		{ label: "Verify", value: "? unverified", color: "#b7af9f" },
	],
	context: { percent: 42, caption: "200k / auto compact", color: "#5fb384" },
	usage: { label: "CODEX", windows: [{ label: "5H", percent: 16 }] },
	sections: [{ title: "Connections", rows: [{ label: "MCP", value: "14/18 ready", color: "#ede6d6" }] }],
	palette: {
		text: "#ede6d6",
		muted: "#b7af9f",
		accent: "#e8564c",
		border: "#504b42",
		background: "#141414",
		surface: "#1c1b19",
	},
	hint: "ctrl+o details   ctrl+q hide",
};
const supported = Number(process.versions.node.split(".")[0]) >= 26;

describe.skipIf(!supported)("real OpenTUI offscreen worker", () => {
	it("composes a colored panel without writing terminal controls or claiming parent stdin", async () => {
		const child = fork(
			fileURLToPath(new URL("../src/modes/interactive/opentui-status-worker.ts", import.meta.url)),
			[],
			{ execArgv: ["--experimental-ffi"], stdio: ["ignore", "pipe", "pipe", "ipc"] },
		);
		let stdout = "";
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr += chunk;
		});
		const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
		try {
			for (const [id, width, height] of [
				[1, 38, 48],
				[2, 34, 32],
				[3, 34, 16],
				[4, 34, 32],
				[5, 34, 16],
			]) {
				const expanded = {
					...model,
					rows: [
						...model.rows,
						{ label: "Cause", value: "timeout", color: model.palette.text },
						{ label: "Retry", value: "manual", color: model.palette.text },
						{ label: "Next", value: "inspect logs", color: model.palette.text },
					],
					usage: {
						label: "CODEX",
						windows: [
							{ label: "5H", percent: 16 },
							{ label: "7D", percent: 23 },
						],
					},
					sections: [
						{
							title: "Connections",
							rows: Array.from({ length: 18 }, (_, i) => ({
								label: `MCP ${i}`,
								value: "ready",
								color: model.palette.text,
							})),
						},
						{ title: "Session", rows: [{ label: "Path", value: model.path, color: model.palette.text }] },
						{ title: "Runtime", rows: [{ label: "Memory", value: "512M", color: model.palette.text }] },
					],
				};
				if (id >= 4) {
					expanded.rows.push(
						{ label: "Tasks", value: "2/4", color: model.palette.text },
						{ label: "Now", value: "Connect data", color: model.palette.text },
						{ label: "Tool", value: "bash 12s", color: model.palette.text },
					);
					expanded.sections.unshift(
						{
							title: "Skills",
							rows: [
								{ label: "Selected", value: "programming", color: model.palette.text },
								{ label: "Loaded", value: "debugging", color: model.palette.text },
							],
						},
						{
							title: "Recent checks",
							rows: [
								{ label: "Tests", value: "7 passed", color: model.palette.text },
								{ label: "Diagnostics", value: "1 error", color: model.palette.text },
							],
						},
					);
				}
				const response = new Promise<{ id: number; lines: string[] }>((resolve, reject) => {
					child.once("message", (value) => resolve(value as { id: number; lines: string[] }));
					child.once("error", reject);
					child.once("exit", (code) => reject(new Error(`worker exited ${code}: ${stderr}`)));
				});
				child.send({ id, width, height, model: expanded });
				const frame = await response;
				expect(frame.id).toBe(id);
				expect(frame.lines).toHaveLength(height);
				expect(frame.lines.every((line) => visibleWidth(line) <= width)).toBe(true);
				const plain = frame.lines.map(stripAnsi).join("\n");
				for (const text of [
					"gpt-6.1-sol",
					"✓ idle",
					"? unverified",
					"42%",
					"CODEX",
					"23%",
					"inspect logs",
					"ctrl+o",
				])
					expect(plain).toContain(text);
				if (height >= 32 && id < 4) expect(plain).toContain("512M");
				if (id >= 4) for (const text of ["2/4", "Connect data", "bash 12s"]) expect(plain).toContain(text);
				if (id === 4)
					for (const text of ["programming", "debugging", "7 passed", "1 error"]) expect(plain).toContain(text);
				if (height >= 48) expect(plain).toContain("Path ");
				for (const text of ["CPU", "82%", "RAM", "75%"]) expect(plain).toContain(text);
				if (height === 16) expect(plain).not.toMatch(/[╭╮╰╯]/);
				expect(frame.lines.join("")).toContain("\x1b[38;2;");
			}
			expect(stdout).toBe("");
		} finally {
			child.kill("SIGTERM");
			await closed;
		}
	}, 20000);
});
