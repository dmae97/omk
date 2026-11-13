// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEffectivePrompt, PROMPT_FILENAME } from "../src/prompt.ts";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function paths() {
	const directory = await mkdtemp(join(tmpdir(), "omk-slye-prompt-"));
	directories.push(directory);
	return {
		global: join(directory, "agent", PROMPT_FILENAME),
		project: join(directory, "project", ".omk", PROMPT_FILENAME),
	};
}
async function writePrompt(path: string, text: string) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, text, "utf8");
}

describe("SLYE prompt loading", () => {
	it("uses the built-in prompt when no override exists", async () => {
		const value = await paths();
		expect(await loadEffectivePrompt(value.global, value.project, true)).toEqual({ kind: "missing" });
	});
	it("prefers a trusted project prompt and preserves bytes", async () => {
		const value = await paths();
		const prompt = "\n  Keep this leading whitespace.\nAnd trailing whitespace.  \n";
		await writePrompt(value.global, "global prompt");
		await writePrompt(value.project, prompt);
		expect(await loadEffectivePrompt(value.global, value.project, true)).toEqual({ kind: "valid", text: prompt });
	});
	it("ignores project files outside project trust", async () => {
		const value = await paths();
		await writePrompt(value.global, "global prompt");
		await writePrompt(value.project, "project prompt");
		expect(await loadEffectivePrompt(value.global, value.project, false)).toEqual({
			kind: "valid",
			text: "global prompt",
		});
	});
	it("fails closed for blank or unreadable selected prompts", async () => {
		const value = await paths();
		await writePrompt(value.global, "global prompt");
		await writePrompt(value.project, "\n \t");
		expect(await loadEffectivePrompt(value.global, value.project, true)).toEqual({
			kind: "invalid",
			path: value.project,
		});
		await rm(value.project);
		await rm(value.global);
		await mkdir(value.global, { recursive: true });
		expect(await loadEffectivePrompt(value.global, value.project, false)).toEqual({
			kind: "invalid",
			path: value.global,
		});
	});
});
