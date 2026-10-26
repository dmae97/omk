import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAgents } from "../examples/extensions/subagent/agents.ts";
import { installProjectPstack } from "../src/commands/pstack-install.ts";
import { getPackageDir } from "../src/config.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { expandSkillCommand } from "../src/core/skill-admission-session.ts";
import { loadSkills, loadSkillsFromDir } from "../src/core/skills.ts";

const bundle = join(getPackageDir(), "resources", "pstack");
let root: string;
let output: string[];
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-pstack-"));
	output = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const line = (message: string) => output.push(message);

describe("bundled pstack project installer", () => {
	it("installs offline and the native skill loader finds poteto-mode and its principles", () => {
		installProjectPstack(root, bundle, false, line);
		const skillsDir = join(root, ".omk", "skills");
		const result = loadSkillsFromDir({ dir: skillsDir, source: "project" });
		expect(result.skills.map((skill) => skill.name)).toContain("pstack-poteto-mode");
		expect(result.skills.map((skill) => skill.name)).toContain("pstack-principle-model-the-domain");
		const expanded = expandSkillCommand(
			"/skill:pstack-poteto-mode inspect",
			result.skills,
			SessionManager.inMemory(),
			"explicit",
			() => {},
		);
		expect(expanded).toContain('<skill name="pstack-poteto-mode"');
		expect(expanded).toContain('agentScope: "project"');
		expect(discoverAgents(root, "project").agents.map((agent) => agent.name)).toEqual([
			"pstack-comment-sicko",
			"pstack-poteto-agent",
		]);
		const commentAgent = readFileSync(join(root, ".omk", "agents", "pstack-comment-sicko.md"), "utf8");
		expect(commentAgent).toContain("/skill:pstack-how");
		expect(commentAgent).toContain("/skill:pstack-why");
		expect(commentAgent).not.toMatch(/\/(?:how|why)\b/);
		expect(readFileSync(join(root, ".omk", "agents", "pstack-poteto-agent.md"), "utf8")).toContain(
			".omk/skills/pstack/poteto-mode/SKILL.md",
		);
		expect(readFileSync(join(skillsDir, "pstack", "LICENSE"), "utf8")).toContain("Copyright (c) 2026 Lauren Tan");
		expect(JSON.parse(readFileSync(join(skillsDir, "pstack", "UPSTREAM.json"), "utf8")).commit).toBe(
			"f51fdeba3d803ef90e4eaa4a95ffb4e76008ab37",
		);
	});

	it("keeps an existing global how skill distinct in the full loader", () => {
		const agentDir = join(root, "agent-home");
		const userHow = join(agentDir, "skills", "how");
		mkdirSync(userHow, { recursive: true });
		writeFileSync(
			join(userHow, "SKILL.md"),
			"---\nname: how\ndescription: Existing user skill\n---\nOriginal user skill.\n",
		);
		installProjectPstack(root, bundle, false, line);
		const result = loadSkills({ cwd: root, agentDir, includeDefaults: true, skillPaths: [], catalogCache: false });
		expect(result.skills.find((skill) => skill.name === "how")?.filePath).toBe(join(userHow, "SKILL.md"));
		expect(result.skills.find((skill) => skill.name === "pstack-how")?.filePath).toBe(
			join(root, ".omk", "skills", "pstack", "how", "SKILL.md"),
		);
		expect(
			result.diagnostics.filter(
				(diagnostic) => diagnostic.type === "collision" && diagnostic.message.includes('name "how"'),
			),
		).toHaveLength(0);
	});

	it("preserves an existing AdaptOrch skill and configuration while installing pstack", () => {
		const agentDir = join(root, "agent-home");
		const skillDir = join(agentDir, "skills", "adaptorch-route");
		mkdirSync(skillDir, { recursive: true });
		const skill = "---\nname: adaptorch-route\ndescription: Existing route skill\n---\nRoute advice.\n";
		writeFileSync(join(skillDir, "SKILL.md"), skill);
		const settings = '{"adaptorchBridge":{"enabled":true}}\n';
		writeFileSync(join(agentDir, "settings.json"), settings);
		installProjectPstack(root, bundle, false, line, undefined, agentDir);
		const result = loadSkills({ cwd: root, agentDir, includeDefaults: true, skillPaths: [], catalogCache: false });
		expect(result.skills.find((item) => item.name === "adaptorch-route")?.filePath).toBe(join(skillDir, "SKILL.md"));
		expect(result.skills.find((item) => item.name === "pstack-poteto-mode")).toBeDefined();
		expect(readFileSync(join(skillDir, "SKILL.md"), "utf8")).toBe(skill);
		expect(readFileSync(join(agentDir, "settings.json"), "utf8")).toBe(settings);
	});

	it.each(["user", "project"] as const)("rejects an existing %s pstack skill before writing", (scope) => {
		const agentDir = join(root, "agent-home");
		const existingDir =
			scope === "user" ? join(agentDir, "skills", "custom") : join(root, ".omk", "skills", "custom");
		mkdirSync(existingDir, { recursive: true });
		const skill = join(existingDir, "SKILL.md");
		const original = "---\nname: pstack-how\ndescription: Existing custom skill\n---\nKeep me.\n";
		writeFileSync(skill, original);
		expect(() => installProjectPstack(root, bundle, false, line, undefined, agentDir)).toThrow(
			"Pstack skill name conflicts: pstack-how",
		);
		expect(readFileSync(skill, "utf8")).toBe(original);
		expect(existsSync(join(root, ".omk", "skills", "pstack"))).toBe(false);
		expect(existsSync(join(root, ".omk", "agents"))).toBe(false);
	});

	it("preserves edited skills and existing agents on reinitialization", () => {
		installProjectPstack(root, bundle, false, line);
		const skill = join(root, ".omk", "skills", "pstack", "poteto-mode", "SKILL.md");
		const agent = join(root, ".omk", "agents", "pstack-poteto-agent.md");
		writeFileSync(skill, "my skill");
		writeFileSync(agent, "my agent");
		installProjectPstack(root, bundle, false, line);
		expect(readFileSync(skill, "utf8")).toBe("my skill");
		expect(readFileSync(agent, "utf8")).toBe("my agent");
	});

	it("retries safely when staging fails before publishing", () => {
		expect(() =>
			installProjectPstack(root, bundle, false, line, () => {
				throw new Error("copy failed");
			}),
		).toThrow("copy failed");
		expect(existsSync(join(root, ".omk", "skills", "pstack"))).toBe(false);
		expect(existsSync(join(root, ".omk", "skills", ".pstack-install.lock"))).toBe(false);
		installProjectPstack(root, bundle, false, line);
		expect(existsSync(join(root, ".omk", "skills", "pstack", "poteto-mode", "SKILL.md"))).toBe(true);
	});

	it("reports an interrupted publish without deleting or treating it as complete", () => {
		let copies = 0;
		expect(() =>
			installProjectPstack(root, bundle, false, line, (source, destination) => {
				if (++copies === 2) {
					writeFileSync(join(destination, "partial.txt"), "preserve");
					throw new Error("copy interrupted");
				}
				cpSync(source, destination, { recursive: true });
			}),
		).toThrow("copy interrupted");
		expect(() => installProjectPstack(root, bundle, false, line)).toThrow("incomplete or already running");
		expect(readFileSync(join(root, ".omk", "skills", "pstack", "partial.txt"), "utf8")).toBe("preserve");
	});

	it("rejects concurrent installation while the first owns the lock", () => {
		let checked = false;
		installProjectPstack(root, bundle, false, line, (source, destination) => {
			if (!checked) {
				checked = true;
				expect(() => installProjectPstack(root, bundle, false, line)).toThrow("incomplete or already running");
			}
			cpSync(source, destination, { recursive: true });
		});
		expect(existsSync(join(root, ".omk", "skills", ".pstack-install.lock"))).toBe(false);
	});

	it("previews without filesystem changes", () => {
		installProjectPstack(root, bundle, true, line);
		expect(readdirSync(root)).toEqual([]);
		expect(output.join("\n")).toContain("Would install pstack skills");
	});

	it.skipIf(process.platform === "win32")("refuses a symlinked project configuration directory", () => {
		const outside = mkdtempSync(join(tmpdir(), "omk-pstack-outside-"));
		try {
			symlinkSync(outside, join(root, ".omk"), "dir");
			expect(() => installProjectPstack(root, bundle, false, line)).toThrow();
			expect(readdirSync(outside)).toEqual([]);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("preserves a preexisting project agent", () => {
		mkdirSync(join(root, ".omk", "agents"), { recursive: true });
		const agent = join(root, ".omk", "agents", "pstack-poteto-agent.md");
		writeFileSync(agent, "custom agent");
		installProjectPstack(root, bundle, false, line);
		expect(readFileSync(agent, "utf8")).toBe("custom agent");
		expect(existsSync(join(root, ".omk", "agents", "pstack-comment-sicko.md"))).toBe(true);
	});
});
