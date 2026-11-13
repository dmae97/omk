// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import { readFile } from "node:fs/promises";

export const PROMPT_FILENAME = "slye-prompt.md";
export type EffectivePrompt = { kind: "missing" } | { kind: "valid"; text: string } | { kind: "invalid"; path: string };

export async function loadEffectivePrompt(
	globalPath: string,
	projectPath: string,
	projectTrusted: boolean,
): Promise<EffectivePrompt> {
	if (projectTrusted) {
		const projectPrompt = await readPrompt(projectPath);
		if (projectPrompt.kind !== "missing") return projectPrompt;
	}
	return readPrompt(globalPath);
}

async function readPrompt(path: string): Promise<EffectivePrompt> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		return isMissingFile(error) ? { kind: "missing" } : { kind: "invalid", path };
	}
	return text.trim() === "" ? { kind: "invalid", path } : { kind: "valid", text };
}
function isMissingFile(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
