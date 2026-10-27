import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const skills = fileURLToPath(new URL("../resources/pstack/skills/", import.meta.url));
const documents = readdirSync(skills, { recursive: true, encoding: "utf8" })
	.filter((name) => name.endsWith(".md") && !name.split(/[\\/]/).includes("node_modules"))
	.map((name) => ({ name, path: join(skills, name), text: readFileSync(join(skills, name), "utf8") }));

describe("OMK-only pstack contract", () => {
	it("does not prescribe unsupported tools, parameters or custom modes", () => {
		const unsupported =
			/Task tool|Task schema|`Task` response|Multiple `Task`|run_in_background|cloud_base_branch|generalPurpose|readonly: false|Custom Mode|Use as Mode|Set `model`/;
		expect(documents.filter(({ text }) => unsupported.test(text)).map(({ name }) => name)).toEqual([]);
	});

	it("does not promise model diversity while delegates inherit the session model", () => {
		const claims =
			/on different models per|on a different model family|each on a different model|models raised independently|adversarial signal comes from model diversity/;
		expect(documents.filter(({ text }) => claims.test(text)).map(({ name }) => name)).toEqual([]);
	});

	it("resolves every local help link within the shipped bundle", () => {
		const help = documents.find(({ name }) => name === "poteto-help/SKILL.md");
		expect(help).toBeDefined();
		const broken = [...(help?.text ?? "").matchAll(/\]\(([^)]+)\)/g)]
			.map((match) => match[1])
			.filter((target) => !target.startsWith("https:") && !target.startsWith("#"))
			.filter((target) => !existsSync(resolve(dirname(help?.path ?? ""), target.split("#")[0])));
		expect(broken).toEqual([]);
	});

	it("describes the session JSONL header and message records without assuming legacy layouts", () => {
		const reflect = documents.find(({ name }) => name === "reflect/SKILL.md")?.text ?? "";
		expect(reflect).toContain("PI_SESSION_FILE");
		expect(reflect).toContain('type: "session"');
		expect(reflect).not.toContain("first JSONL line. Take the file whose `message.content");
	});
});
