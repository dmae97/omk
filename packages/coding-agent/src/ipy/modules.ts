import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type PythonModuleSource = "user" | "project";

export interface PythonModuleEntry {
	path: string;
	content: string;
	source: PythonModuleSource;
}

export interface PythonModuleExecuteResult {
	status: "ok" | "error";
	cancelled: boolean;
	error?: { name: string; value: string; traceback: string[] };
}

export interface PythonModuleExecutor {
	execute: (
		code: string,
		options?: { silent?: boolean; storeHistory?: boolean },
	) => Promise<PythonModuleExecuteResult>;
}

export interface DiscoverPythonModulesOptions {
	/** Working directory for project-level modules. Default: process.cwd() */
	cwd?: string;
	/** Home directory for user-level modules. Default: os.homedir() */
	homeDir?: string;
}

interface ModuleCandidate {
	name: string;
	path: string;
	source: PythonModuleSource;
}

async function listModuleCandidates(dir: string, source: PythonModuleSource): Promise<ModuleCandidate[]> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".py"))
			.map((entry) => ({
				name: entry.name,
				path: resolve(dir, entry.name),
				source,
			}));
	} catch {
		return [];
	}
}

async function readModuleContent(candidate: ModuleCandidate): Promise<PythonModuleEntry> {
	try {
		const content = await Bun.file(candidate.path).text();
		return { path: candidate.path, content, source: candidate.source };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to read Python module ${candidate.path}: ${message}`);
	}
}

/**
 * Discover Python prelude extension modules from user and project directories.
 */
export async function discoverPythonModules(options: DiscoverPythonModulesOptions = {}): Promise<PythonModuleEntry[]> {
	const cwd = options.cwd ?? process.cwd();
	const homeDir = options.homeDir ?? homedir();

	const userDirs = [join(homeDir, ".omp", "agent", "modules"), join(homeDir, ".pi", "agent", "modules")];
	const projectDirs = [resolve(cwd, ".omp", "modules"), resolve(cwd, ".pi", "modules")];

	const userCandidates = (await Promise.all(userDirs.map((dir) => listModuleCandidates(dir, "user")))).flat();
	const projectCandidates = (await Promise.all(projectDirs.map((dir) => listModuleCandidates(dir, "project")))).flat();

	const byName = new Map<string, ModuleCandidate>();
	for (const candidate of userCandidates) {
		if (!byName.has(candidate.name)) {
			byName.set(candidate.name, candidate);
		}
	}
	for (const candidate of projectCandidates) {
		const existing = byName.get(candidate.name);
		if (!existing || existing.source === "user") {
			byName.set(candidate.name, candidate);
		}
	}

	const sorted = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
	return Promise.all(sorted.map((candidate) => readModuleContent(candidate)));
}

/**
 * Load Python prelude extension modules into an active kernel.
 */
export async function loadPythonModules(
	executor: PythonModuleExecutor,
	options: DiscoverPythonModulesOptions = {},
): Promise<PythonModuleEntry[]> {
	const modules = await discoverPythonModules(options);
	for (const module of modules) {
		const result = await executor.execute(module.content, { silent: true, storeHistory: false });
		if (result.cancelled || result.status === "error") {
			const details = result.error ? `${result.error.name}: ${result.error.value}` : "unknown error";
			throw new Error(`Failed to load Python module ${module.path}: ${details}`);
		}
	}
	return modules;
}
