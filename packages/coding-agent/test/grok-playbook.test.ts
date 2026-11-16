import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import {
	GROK_PLAYBOOK_MAX_APPEND_CHARS,
	grokPlaybookAppendForProvider,
	loadGrokPlaybookAppend,
} from "../src/core/grok-playbook.ts";

let dir: string;
let previousAgentDir: string | undefined;

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-grok-playbook-"));
	previousAgentDir = process.env[ENV_AGENT_DIR];
	process.env[ENV_AGENT_DIR] = dir;
});

afterEach(() => {
	if (previousAgentDir === undefined) {
		delete process.env[ENV_AGENT_DIR];
	} else {
		process.env[ENV_AGENT_DIR] = previousAgentDir;
	}
	fs.rmSync(dir, { recursive: true, force: true });
});

function writePlaybook(text: string): void {
	fs.writeFileSync(path.join(dir, "grok.md"), text);
}

describe("grokPlaybookAppendForProvider", () => {
	it("returns undefined for anthropic even when grok.md exists", () => {
		writePlaybook("hello");
		expect(grokPlaybookAppendForProvider("anthropic")).toBeUndefined();
	});

	it("returns undefined for an undefined provider even when grok.md exists", () => {
		writePlaybook("hello");
		expect(grokPlaybookAppendForProvider(undefined)).toBeUndefined();
	});

	it("returns the file text for the xai provider", () => {
		writePlaybook("  hello \n");
		expect(grokPlaybookAppendForProvider("xai")).toBe("hello");
	});
});

describe("loadGrokPlaybookAppend", () => {
	it("returns undefined when grok.md is missing", () => {
		expect(loadGrokPlaybookAppend()).toBeUndefined();
	});

	it("returns undefined for a whitespace-only file", () => {
		writePlaybook("  \n\t \n");
		expect(loadGrokPlaybookAppend()).toBeUndefined();
	});

	it("trims surrounding whitespace", () => {
		writePlaybook("  hello \n");
		expect(loadGrokPlaybookAppend()).toBe("hello");
	});

	it("returns a file at exactly the cap unchanged", () => {
		const text = "a".repeat(GROK_PLAYBOOK_MAX_APPEND_CHARS);
		writePlaybook(text);
		expect(loadGrokPlaybookAppend()).toBe(text);
	});

	it("truncates one char over the cap and names the full file", () => {
		writePlaybook("a".repeat(GROK_PLAYBOOK_MAX_APPEND_CHARS + 1));
		expect(loadGrokPlaybookAppend()).toBe(
			`${"a".repeat(GROK_PLAYBOOK_MAX_APPEND_CHARS)}\n\n[... grok.md truncated for system prompt; full file: ${path.join(dir, "grok.md")}]`,
		);
	});

	it("returns undefined when grok.md is a directory", () => {
		fs.mkdirSync(path.join(dir, "grok.md"));
		expect(loadGrokPlaybookAppend()).toBeUndefined();
	});
});
