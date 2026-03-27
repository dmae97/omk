import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadPythonModules, type PythonModuleExecutor } from "@oh-my-pi/pi-coding-agent/ipy/modules";
import { getAgentModulesDir, getProjectModulesDir, TempDir } from "@oh-my-pi/pi-utils";

const fixturesDir = path.resolve(import.meta.dir, "../../test/fixtures/python-modules");

const readFixture = (name: string): Promise<string> => Bun.file(path.join(fixturesDir, name)).text();

const writeModule = async (dir: string, name: string, tag: string) => {
	await fs.mkdir(dir, { recursive: true });
	const base = await readFixture(name);
	await Bun.write(path.join(dir, name), `${base}\n# ${tag}`);
};

describe("python modules", () => {
	let tempRoot: TempDir | null = null;

	afterEach(() => {
		if (tempRoot) {
			tempRoot.removeSync();
		}
		tempRoot = null;
		vi.restoreAllMocks();
	});

	it("loads modules in sorted order and forwards startup execute options", async () => {
		tempRoot = TempDir.createSync("@omp-python-modules-");
		const agentDir = path.join(tempRoot.path(), "agent");
		const cwd = path.join(tempRoot.path(), "project");
		const signal = new AbortController().signal;

		await writeModule(getAgentModulesDir(agentDir), "beta.py", "user-omp");
		await writeModule(getAgentModulesDir(agentDir), "alpha.py", "user-omp");

		const calls: Array<{
			name: string;
			options?: { signal?: AbortSignal; timeoutMs?: number; silent?: boolean; storeHistory?: boolean };
		}> = [];
		const executor: PythonModuleExecutor = {
			execute: async (code: string, options) => {
				const name = code.includes("def alpha") ? "alpha" : "beta";
				calls.push({ name, options });
				return { status: "ok", cancelled: false };
			},
		};

		await loadPythonModules(executor, { cwd, agentDir, signal, timeoutMs: 987 });
		expect(calls.map(call => call.name)).toEqual(["alpha", "beta"]);
		for (const call of calls) {
			expect(call.options).toEqual({ signal, timeoutMs: 987, silent: true, storeHistory: false });
		}
	});

	it("derives module execution timeout from the remaining deadline", async () => {
		tempRoot = TempDir.createSync("@omp-python-modules-");
		const agentDir = path.join(tempRoot.path(), "agent");
		const cwd = path.join(tempRoot.path(), "project");
		const signal = new AbortController().signal;

		await writeModule(getProjectModulesDir(cwd), "alpha.py", "project-omp");

		const execute = vi.fn(
			async (
				_code: string,
				_options?: {
					signal?: AbortSignal;
					timeoutMs?: number;
					silent?: boolean;
					storeHistory?: boolean;
				},
			) => ({ status: "ok" as const, cancelled: false }),
		);
		const executor: PythonModuleExecutor = { execute };
		vi.spyOn(Date, "now").mockReturnValue(10_000);

		await loadPythonModules(executor, { cwd, agentDir, signal, deadlineMs: 10_250 });
		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute).toHaveBeenCalledWith(expect.any(String), {
			signal,
			timeoutMs: 250,
			silent: true,
			storeHistory: false,
		});
	});

	it("fails fast when the module deadline expires before the next execution starts", async () => {
		tempRoot = TempDir.createSync("@omp-python-modules-");
		const agentDir = path.join(tempRoot.path(), "agent");
		const cwd = path.join(tempRoot.path(), "project");
		const signal = new AbortController().signal;

		await writeModule(getProjectModulesDir(cwd), "alpha.py", "project-omp");
		await writeModule(getProjectModulesDir(cwd), "beta.py", "project-omp");

		const execute = vi.fn(async () => ({ status: "ok" as const, cancelled: false }));
		const executor: PythonModuleExecutor = { execute };
		vi.spyOn(Date, "now").mockReturnValueOnce(10_000).mockReturnValueOnce(10_300);

		await expect(loadPythonModules(executor, { cwd, agentDir, signal, deadlineMs: 10_250 })).rejects.toMatchObject({
			name: "TimeoutError",
			message: "Python module loading timed out",
		});
		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute).toHaveBeenCalledWith(expect.any(String), {
			signal,
			timeoutMs: 250,
			silent: true,
			storeHistory: false,
		});
	});

	it("preserves timeout classification when module execution is cancelled", async () => {
		tempRoot = TempDir.createSync("@omp-python-modules-");
		const agentDir = path.join(tempRoot.path(), "agent");
		const cwd = path.join(tempRoot.path(), "project");

		await writeModule(getProjectModulesDir(cwd), "alpha.py", "project-omp");

		const execute = vi.fn(async () => ({ status: "ok" as const, cancelled: true, timedOut: true }));
		const executor: PythonModuleExecutor = { execute };

		await expect(loadPythonModules(executor, { cwd, agentDir })).rejects.toMatchObject({
			name: "TimeoutError",
			message: expect.stringContaining("Failed to load Python module"),
		});
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("fails fast when a module fails to execute", async () => {
		tempRoot = TempDir.createSync("@omp-python-modules-");
		const agentDir = path.join(tempRoot.path(), "agent");
		const cwd = path.join(tempRoot.path(), "project");

		await writeModule(getAgentModulesDir(agentDir), "alpha.py", "user-omp");
		await writeModule(getProjectModulesDir(cwd), "beta.py", "project-omp");

		const executor: PythonModuleExecutor = {
			execute: async (code: string) => {
				if (code.includes("def beta")) {
					return {
						status: "error",
						cancelled: false,
						error: { name: "Error", value: "boom", traceback: [] },
					};
				}
				return { status: "ok", cancelled: false };
			},
		};

		await expect(loadPythonModules(executor, { cwd, agentDir })).rejects.toThrow("Failed to load Python module");
	});
});
