import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentModulesDir, getProjectDir, getProjectModulesDir } from "@oh-my-pi/pi-utils";
import { getExecutionCancellationError } from "./cancellation";

export type PythonModuleSource = "user" | "project";

export interface PythonModuleEntry {
	path: string;
	content: string;
	source: PythonModuleSource;
}

export interface PythonModuleExecuteResult {
	status: "ok" | "error";
	cancelled: boolean;
	timedOut?: boolean;
	error?: { name: string; value: string; traceback: string[] };
}

export interface PythonModuleExecutor {
	execute: (
		code: string,
		options?: { signal?: AbortSignal; timeoutMs?: number; silent?: boolean; storeHistory?: boolean },
	) => Promise<PythonModuleExecuteResult>;
}

export interface DiscoverPythonModulesOptions {
	/** Working directory for project-level modules. Default: getProjectDir() */
	cwd?: string;
	/** Agent directory for user-level modules. Default: from getAgentDir() */
	agentDir?: string;
}

export interface LoadPythonModulesOptions extends DiscoverPythonModulesOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
	deadlineMs?: number;
}

interface ModuleCandidate {
	name: string;
	path: string;
	source: PythonModuleSource;
}

async function listModuleCandidates(dir: string, source: PythonModuleSource): Promise<ModuleCandidate[]> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		return entries
			.filter(entry => entry.isFile() && entry.name.endsWith(".py"))
			.map(entry => ({
				name: entry.name,
				path: path.resolve(dir, entry.name),
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

function createTimeoutError(message: string): Error {
	const error = new Error(message);
	error.name = "TimeoutError";
	return error;
}

function requireModuleExecutionTimeoutMs(options: LoadPythonModulesOptions): number | undefined {
	if (options.deadlineMs === undefined) {
		return options.timeoutMs;
	}

	const remainingMs = options.deadlineMs - Date.now();
	if (remainingMs <= 0) {
		throw createTimeoutError("Python module loading timed out");
	}

	return remainingMs;
}

/**
 * Discover Python prelude extension modules from user and project directories.
 */
export async function discoverPythonModules(options: DiscoverPythonModulesOptions = {}): Promise<PythonModuleEntry[]> {
	const cwd = options.cwd ?? getProjectDir();

	const userDir = getAgentModulesDir(options.agentDir);
	const projectDir = getProjectModulesDir(cwd);

	const userCandidates = await listModuleCandidates(userDir, "user");
	const projectCandidates = await listModuleCandidates(projectDir, "project");

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
	return Promise.all(sorted.map(candidate => readModuleContent(candidate)));
}

/**
 * Load Python prelude extension modules into an active kernel.
 */
export async function loadPythonModules(
	executor: PythonModuleExecutor,
	options: LoadPythonModulesOptions = {},
): Promise<PythonModuleEntry[]> {
	const modules = await discoverPythonModules(options);
	for (const module of modules) {
		const result = await executor.execute(module.content, {
			signal: options.signal,
			timeoutMs: requireModuleExecutionTimeoutMs(options),
			silent: true,
			storeHistory: false,
		});
		if (result.cancelled) {
			throw getExecutionCancellationError(result, options.signal, `Failed to load Python module ${module.path}`);
		}
		if (result.status === "error") {
			const details = result.error ? `${result.error.name}: ${result.error.value}` : "unknown error";
			throw new Error(`Failed to load Python module ${module.path}: ${details}`);
		}
	}
	return modules;
}
