import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";
import { loadSkills } from "../../../src/core/skills.ts";
import type { SourceInfo } from "../../../src/core/source-info.ts";

describe("issue #2781 skill collision precedence: user skills should override package skills", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-2781-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function createPackageWithSkill(name: string, description: string): string {
		const pkgDir = join(tempDir, `fake-package-${name}`);
		const skillDir = join(pkgDir, "skills", name);
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(pkgDir, "package.json"),
			JSON.stringify({ name: `fake-pkg-${name}`, version: "1.0.0", pi: { skills: [`skills/${name}`] } }, null, 2),
		);
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---\nname: ${name}\ndescription: ${description}\n---\nPackage skill content`,
		);
		return pkgDir;
	}

	function createPackageSkillInDir(dirName: string, name: string, description: string, content: string): string {
		const pkgDir = join(tempDir, dirName);
		const skillDir = join(pkgDir, "skills", name);
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(pkgDir, "package.json"),
			JSON.stringify({ name: dirName, version: "1.0.0", pi: { skills: [`skills/${name}`] } }, null, 2),
		);
		const skillPath = join(skillDir, "SKILL.md");
		writeFileSync(skillPath, `---\nname: ${name}\ndescription: ${description}\n---\n${content}`);
		return skillPath;
	}

	function createUserSkill(name: string, description: string): string {
		const skillDir = join(agentDir, "skills", name);
		mkdirSync(skillDir, { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		writeFileSync(skillPath, `---\nname: ${name}\ndescription: ${description}\n---\nUser skill content`);
		return skillPath;
	}

	function createProjectSkill(name: string, description: string): string {
		const skillDir = join(cwd, ".omk", "skills", name);
		mkdirSync(skillDir, { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		writeFileSync(skillPath, `---\nname: ${name}\ndescription: ${description}\n---\nProject skill content`);
		return skillPath;
	}

	function createProjectSkillInDir(dirName: string, name: string, description: string, content: string): string {
		const skillDir = join(cwd, ".omk", "skills", dirName);
		mkdirSync(skillDir, { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		writeFileSync(skillPath, `---\nname: ${name}\ndescription: ${description}\n---\n${content}`);
		return skillPath;
	}

	function createUserSkillInDir(dirName: string, name: string, description: string, content: string): string {
		const skillDir = join(agentDir, "skills", dirName);
		mkdirSync(skillDir, { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		writeFileSync(skillPath, `---\nname: ${name}\ndescription: ${description}\n---\n${content}`);
		return skillPath;
	}

	function createSettingsWithPackage(pkgDir: string, scope: "user" | "project"): void {
		const settingsDir = scope === "user" ? agentDir : join(cwd, ".omk");
		mkdirSync(settingsDir, { recursive: true });
		writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({ packages: [pkgDir] }, null, 2));
	}

	it("user auto-discovered skill should override package skill with same name", async () => {
		const pkgDir = createPackageWithSkill("web-fetch", "Package web-fetch skill");
		const userSkillPath = createUserSkill("web-fetch", "User web-fetch override");
		createSettingsWithPackage(pkgDir, "user");

		const loader = new DefaultResourceLoader({ cwd, agentDir });
		await loader.reload();

		const { skills } = loader.getSkills();
		const webFetch = skills.find((s) => s.name === "web-fetch");
		expect(webFetch).toBeDefined();
		expect(webFetch!.filePath).toBe(userSkillPath);
		expect(webFetch!.description).toBe("User web-fetch override");
	});

	it("project auto-discovered skill should override package skill with same name", async () => {
		const pkgDir = createPackageWithSkill("web-fetch", "Package web-fetch skill");
		const projectSkillPath = createProjectSkill("web-fetch", "Project web-fetch override");
		createSettingsWithPackage(pkgDir, "user");

		const loader = new DefaultResourceLoader({ cwd, agentDir });
		await loader.reload();

		const { skills } = loader.getSkills();
		const webFetch = skills.find((s) => s.name === "web-fetch");
		expect(webFetch).toBeDefined();
		expect(webFetch!.filePath).toBe(projectSkillPath);
		expect(webFetch!.description).toBe("Project web-fetch override");
	});

	it("project skill should override user skill which should override package skill", async () => {
		const pkgDir = createPackageWithSkill("web-fetch", "Package web-fetch skill");
		createUserSkill("web-fetch", "User web-fetch override");
		const projectSkillPath = createProjectSkill("web-fetch", "Project web-fetch override");
		createSettingsWithPackage(pkgDir, "user");

		const loader = new DefaultResourceLoader({ cwd, agentDir });
		await loader.reload();

		const { skills } = loader.getSkills();
		const webFetch = skills.find((s) => s.name === "web-fetch");
		expect(webFetch).toBeDefined();
		expect(webFetch!.filePath).toBe(projectSkillPath);
		expect(webFetch!.description).toBe("Project web-fetch override");
	});

	it("same-scope collisions should keep the lexicographically first discovered project skill", async () => {
		const laterSkillPath = createProjectSkillInDir(
			"z-web-fetch",
			"web-fetch",
			"Later project web-fetch",
			"Later project content",
		);
		const earlierSkillPath = createProjectSkillInDir(
			"a-web-fetch",
			"web-fetch",
			"Earlier project web-fetch",
			"Earlier project content",
		);

		const loader = new DefaultResourceLoader({ cwd, agentDir });
		await loader.reload();

		const { diagnostics, skills } = loader.getSkills();
		const webFetch = skills.find((s) => s.name === "web-fetch");
		const collision = diagnostics.find((d) => d.type === "collision" && d.collision?.name === "web-fetch");

		expect(webFetch).toBeDefined();
		expect(webFetch!.filePath).toBe(earlierSkillPath);
		expect(webFetch!.description).toBe("Earlier project web-fetch");
		expect(collision?.collision).toMatchObject({
			winnerPath: earlierSkillPath,
			loserPath: laterSkillPath,
			winnerSource: "auto",
			loserSource: "auto",
			winnerScope: "project",
			loserScope: "project",
			winnerOrigin: "top-level",
			loserOrigin: "top-level",
		});
	});

	it("same-precedence project skill paths should resolve by canonical path with actionable diagnostics", () => {
		const laterSkillPath = createProjectSkillInDir(
			"z-web-fetch",
			"web-fetch",
			"Later project web-fetch",
			"Later project content",
		);
		const earlierSkillPath = createProjectSkillInDir(
			"a-web-fetch",
			"web-fetch",
			"Earlier project web-fetch",
			"Earlier project content",
		);

		const { diagnostics, skills } = loadSkills({
			cwd,
			agentDir,
			includeDefaults: false,
			skillPaths: [laterSkillPath, earlierSkillPath],
		});

		const webFetch = skills.find((skill) => skill.name === "web-fetch");
		const collision = diagnostics.find(
			(diagnostic) => diagnostic.type === "collision" && diagnostic.collision?.name === "web-fetch",
		);

		expect(webFetch?.filePath).toBe(earlierSkillPath);
		expect(collision?.message).toContain("same-precedence canonical path ordering");
		expect(collision?.message).toContain("Rename one skill or move one duplicate");
		expect(collision?.collision).toMatchObject({
			winnerPath: earlierSkillPath,
			loserPath: laterSkillPath,
			winnerSource: "local",
			loserSource: "local",
			winnerScope: "project",
			loserScope: "project",
			winnerOrigin: "top-level",
			loserOrigin: "top-level",
			resolutionReason: "same-precedence canonical path ordering",
			resolutionAction: "Rename one skill or move one duplicate so the intended canonical path sorts first.",
		});
	});

	it("identical same-name project skills should stay silently deduplicated", () => {
		const laterSkillPath = createProjectSkillInDir("z-web-fetch", "web-fetch", "Project web-fetch", "Shared content");
		const earlierSkillPath = createProjectSkillInDir(
			"a-web-fetch",
			"web-fetch",
			"Project web-fetch",
			"Shared content",
		);

		const { diagnostics, skills } = loadSkills({
			cwd,
			agentDir,
			includeDefaults: false,
			skillPaths: [laterSkillPath, earlierSkillPath],
		});

		expect(skills.filter((skill) => skill.name === "web-fetch").map((skill) => skill.filePath)).toEqual([
			earlierSkillPath,
		]);
		expect(
			diagnostics.some(
				(diagnostic) => diagnostic.type === "collision" && diagnostic.collision?.name === "web-fetch",
			),
		).toBe(false);
	});

	it("project settings skill should override auto-discovered project skill when canonical path sorts later", async () => {
		const autoSkillPath = createProjectSkillInDir(
			"a-web-fetch",
			"web-fetch",
			"Auto project web-fetch",
			"Auto project content",
		);
		const configuredSkillPath = createProjectSkillInDir(
			"z-web-fetch",
			"web-fetch",
			"Configured project web-fetch",
			"Configured project content",
		);
		const settingsManager = SettingsManager.inMemory();
		settingsManager.setProjectSkillPaths([configuredSkillPath]);

		const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
		await loader.reload();

		const { diagnostics, skills } = loader.getSkills();
		const webFetch = skills.find((skill) => skill.name === "web-fetch");
		const collision = diagnostics.find(
			(diagnostic) => diagnostic.type === "collision" && diagnostic.collision?.name === "web-fetch",
		);

		expect(webFetch?.filePath).toBe(configuredSkillPath);
		expect(webFetch?.description).toBe("Configured project web-fetch");
		expect(webFetch?.sourceInfo).toMatchObject({
			source: "local",
			scope: "project",
			origin: "top-level",
		});
		expect(collision?.collision).toMatchObject({
			winnerPath: configuredSkillPath,
			loserPath: autoSkillPath,
			winnerSource: "local",
			loserSource: "auto",
			winnerScope: "project",
			loserScope: "project",
			winnerOrigin: "top-level",
			loserOrigin: "top-level",
			resolutionReason: "higher-precedence skill source",
		});
	});

	it("user settings skill should override auto-discovered user skill when canonical path sorts later", async () => {
		const autoSkillPath = createUserSkillInDir(
			"a-user-web-fetch",
			"user-web-fetch",
			"Auto user web-fetch",
			"Auto user content",
		);
		const configuredSkillPath = createUserSkillInDir(
			"z-user-web-fetch",
			"user-web-fetch",
			"Configured user web-fetch",
			"Configured user content",
		);
		const settingsManager = SettingsManager.inMemory();
		settingsManager.setSkillPaths([configuredSkillPath]);

		const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
		await loader.reload();

		const { diagnostics, skills } = loader.getSkills();
		const webFetch = skills.find((skill) => skill.name === "user-web-fetch");
		const collision = diagnostics.find(
			(diagnostic) => diagnostic.type === "collision" && diagnostic.collision?.name === "user-web-fetch",
		);

		expect(webFetch?.filePath).toBe(configuredSkillPath);
		expect(webFetch?.description).toBe("Configured user web-fetch");
		expect(webFetch?.sourceInfo).toMatchObject({
			source: "local",
			scope: "user",
			origin: "top-level",
		});
		expect(collision?.collision).toMatchObject({
			winnerPath: configuredSkillPath,
			loserPath: autoSkillPath,
			winnerSource: "local",
			loserSource: "auto",
			winnerScope: "user",
			loserScope: "user",
			winnerOrigin: "top-level",
			loserOrigin: "top-level",
			resolutionReason: "higher-precedence skill source",
		});
	});

	it("project package skill should override user package skill when canonical path favors user package", () => {
		const userPackageSkillPath = createPackageSkillInDir(
			"aa-user-package",
			"web-fetch",
			"User package web-fetch",
			"User package content",
		);
		const projectPackageSkillPath = createPackageSkillInDir(
			"zz-project-package",
			"web-fetch",
			"Project package web-fetch",
			"Project package content",
		);
		const sourceInfos = new Map<string, SourceInfo>([
			[
				userPackageSkillPath,
				{
					path: userPackageSkillPath,
					source: "local:aa-user-package",
					scope: "user",
					origin: "package",
					baseDir: join(tempDir, "aa-user-package"),
				},
			],
			[
				projectPackageSkillPath,
				{
					path: projectPackageSkillPath,
					source: "local:zz-project-package",
					scope: "project",
					origin: "package",
					baseDir: join(tempDir, "zz-project-package"),
				},
			],
		]);

		const { diagnostics, skills } = loadSkills({
			cwd,
			agentDir,
			includeDefaults: false,
			skillPaths: [projectPackageSkillPath, userPackageSkillPath],
			resolveSourceInfo: (filePath) => sourceInfos.get(filePath),
		});

		const webFetch = skills.find((skill) => skill.name === "web-fetch");
		const collision = diagnostics.find(
			(diagnostic) => diagnostic.type === "collision" && diagnostic.collision?.name === "web-fetch",
		);

		expect(webFetch?.filePath).toBe(projectPackageSkillPath);
		expect(webFetch?.description).toBe("Project package web-fetch");
		expect(collision?.collision).toMatchObject({
			winnerPath: projectPackageSkillPath,
			loserPath: userPackageSkillPath,
			winnerScope: "project",
			loserScope: "user",
			winnerOrigin: "package",
			loserOrigin: "package",
			resolutionReason: "higher-precedence skill source",
		});
	});

	it("collision diagnostics should report package skill as loser when user skill wins", async () => {
		const pkgDir = createPackageWithSkill("web-fetch", "Package web-fetch skill");
		createUserSkill("web-fetch", "User web-fetch override");
		createSettingsWithPackage(pkgDir, "user");

		const loader = new DefaultResourceLoader({ cwd, agentDir });
		await loader.reload();

		const { diagnostics } = loader.getSkills();
		const collision = diagnostics.find((d) => d.type === "collision" && d.collision?.name === "web-fetch");
		expect(collision).toBeDefined();
		expect(collision!.collision!.loserPath).toContain("fake-package");
	});
});
