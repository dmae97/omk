import {
	closeSync,
	constants,
	copyFileSync,
	cpSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	unlinkSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { getAgentDir } from "../config.ts";
import { loadSkills, loadSkillsFromDir } from "../core/skills.ts";

export class PstackConflictError extends Error {}

function ensureDirectory(path: string, dryRun: boolean): void {
	const existing = lstatSync(path, { throwIfNoEntry: false });
	if (existing && !existing.isDirectory()) throw new Error(`pstack destination is not a real directory: ${path}`);
	if (!existing && !dryRun) mkdirSync(path, { mode: 0o700 });
}

/** Validate destinations and detect default project/user skill-name collisions before writes. */
export function preflightProjectPstack(projectDir: string, bundleDir: string, agentDir = getAgentDir()): void {
	const config = join(projectDir, ".omk");
	const skillsDir = join(config, "skills");
	const targetSkills = join(skillsDir, "pstack");
	for (const dir of [config, skillsDir, join(config, "agents"), targetSkills]) ensureDirectory(dir, true);
	if (lstatSync(join(skillsDir, ".pstack-install.lock"), { throwIfNoEntry: false })) {
		throw new Error("pstack installation is incomplete or already running");
	}
	if (lstatSync(targetSkills, { throwIfNoEntry: false })) return;
	const bundled = loadSkillsFromDir({ dir: join(bundleDir, "skills"), source: "project" }).skills;
	if (bundled.length === 0) throw new Error("pstack bundle is incomplete");
	const existing = loadSkills({
		cwd: projectDir,
		agentDir,
		includeDefaults: true,
		skillPaths: [],
		catalogCache: false,
	}).skills;
	const userBundle = join(agentDir, "skills", "pstack");
	let sameBundle = false;
	try {
		const user = JSON.parse(readFileSync(join(userBundle, "UPSTREAM.json"), "utf8"));
		const shipped = JSON.parse(readFileSync(join(bundleDir, "UPSTREAM.json"), "utf8"));
		sameBundle = user.source === shipped.source && user.commit === shipped.commit;
	} catch {
		// Unidentified user skills remain protected from project-level shadowing.
	}
	const existingNames = new Set(
		existing
			.filter((skill) => {
				const path = relative(userBundle, skill.filePath);
				return !(sameBundle && path && !path.startsWith(`..${sep}`) && path !== "..");
			})
			.map((skill) => skill.name),
	);
	const conflicts = bundled
		.map((skill) => skill.name)
		.filter((name) => existingNames.has(name))
		.sort();
	if (conflicts.length)
		throw new PstackConflictError(
			`Pstack skill name conflicts: ${conflicts.join(", ")}. Rename the existing skill before retrying.`,
		);
}

/** Install the pinned local distribution without replacing project resources or executing its scripts. */
export function installProjectPstack(
	projectDir: string,
	bundleDir: string,
	dryRun: boolean,
	writeLine: (line: string) => void,
	copyTree: (source: string, destination: string) => void = (source, destination) => {
		for (const name of readdirSync(source)) {
			cpSync(join(source, name), join(destination, name), { recursive: true, force: false, errorOnExist: true });
		}
	},
	agentDir = getAgentDir(),
): void {
	const config = join(projectDir, ".omk");
	const agentsDir = join(config, "agents");
	const skillsDir = join(config, "skills");
	const targetSkills = join(skillsDir, "pstack");
	const lockPath = join(skillsDir, ".pstack-install.lock");
	const sourceSkills = join(bundleDir, "skills");
	const sourceAgents = join(bundleDir, "agents");
	const agents = readdirSync(sourceAgents, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => entry.name)
		.sort();
	if (agents.length === 0 || !lstatSync(sourceSkills).isDirectory()) throw new Error("pstack bundle is incomplete");
	preflightProjectPstack(projectDir, bundleDir, agentDir);

	for (const dir of [config, skillsDir, agentsDir]) ensureDirectory(dir, dryRun);
	if (lstatSync(lockPath, { throwIfNoEntry: false })) {
		throw new Error(`pstack installation is incomplete or already running: ${lockPath}`);
	}
	const existingSkills = lstatSync(targetSkills, { throwIfNoEntry: false });
	if (existingSkills && !existingSkills.isDirectory())
		throw new Error("pstack skill destination is not a real directory");
	if (existingSkills) writeLine(`Preserved pstack skills: ${JSON.stringify(targetSkills)}`);
	else if (dryRun) writeLine(`Would install pstack skills: ${JSON.stringify(targetSkills)}`);
	else {
		const lock = openSync(lockPath, "wx", 0o600);
		closeSync(lock);
		let staging: string | undefined;
		let published = false;
		try {
			staging = mkdtempSync(join(skillsDir, ".pstack-stage-"));
			copyTree(sourceSkills, staging);
			copyFileSync(join(bundleDir, "LICENSE"), join(staging, "LICENSE"), constants.COPYFILE_EXCL);
			copyFileSync(join(bundleDir, "UPSTREAM.json"), join(staging, "UPSTREAM.json"), constants.COPYFILE_EXCL);
			mkdirSync(targetSkills, { mode: 0o700 });
			published = true;
			copyTree(staging, targetSkills);
			writeLine(`Installed pstack skills: ${JSON.stringify(targetSkills)}`);
			unlinkSync(lockPath);
		} catch (error) {
			// A published partial tree is never deleted automatically or mistaken for a complete install.
			if (!published) unlinkSync(lockPath);
			throw error;
		} finally {
			if (staging) rmSync(staging, { recursive: true, force: true });
		}
	}
	installPstackAgents(config, bundleDir, dryRun, writeLine);
	writeLine(
		"Project agents require explicit project scope. Interactive runs prompt for trust; headless runs cannot prompt.",
	);
}

/** Install bundled agent definitions without replacing user-owned files. */
export function installPstackAgents(
	config: string,
	bundleDir: string,
	dryRun: boolean,
	writeLine: (line: string) => void,
): void {
	const agentsDir = join(config, "agents");
	ensureDirectory(agentsDir, dryRun);
	const sourceAgents = join(bundleDir, "agents");
	const agents = readdirSync(sourceAgents, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => entry.name)
		.sort();
	if (agents.length === 0) throw new Error("pstack bundle is incomplete");
	for (const agent of agents) {
		const destination = join(agentsDir, agent);
		if (lstatSync(destination, { throwIfNoEntry: false })) {
			writeLine(`Preserved agent: ${JSON.stringify(destination)}`);
		} else if (dryRun) {
			writeLine(`Would install agent: ${JSON.stringify(destination)}`);
		} else {
			try {
				copyFileSync(join(sourceAgents, agent), destination, constants.COPYFILE_EXCL);
				writeLine(`Installed agent: ${JSON.stringify(destination)}`);
			} catch (error) {
				if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
				writeLine(`Preserved concurrent agent: ${JSON.stringify(destination)}`);
			}
		}
	}
}
