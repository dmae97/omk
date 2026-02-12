import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadPythonModules, type PythonModuleExecutor } from "@oh-my-pi/pi-coding-agent/ipy/modules";
import { TempDir } from "@oh-my-pi/pi-utils";

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
	});

	it("loads modules in sorted order with silent execution", async () => {
		tempRoot = TempDir.createSync("@omp-python-modules-");
		const homeDir = path.join(tempRoot.path(), "home");
		const cwd = path.join(tempRoot.path(), "project");

		await writeModule(path.join(homeDir, ".omp", "agent", "modules"), "beta.py", "user-omp");
		await writeModule(path.join(homeDir, ".omp", "agent", "modules"), "alpha.py", "user-omp");

		const calls: Array<{ name: string; options?: { silent?: boolean; storeHistory?: boolean } }> = [];
		const executor: PythonModuleExecutor = {
			execute: async (code: string, options?: { silent?: boolean; storeHistory?: boolean }) => {
				const name = code.includes("def alpha") ? "alpha" : "beta";
				calls.push({ name, options });
				return { status: "ok", cancelled: false };
			},
		};

		await loadPythonModules(executor, { cwd, homeDir });
		expect(calls.map(call => call.name)).toEqual(["alpha", "beta"]);
		for (const call of calls) {
			expect(call.options).toEqual({ silent: true, storeHistory: false });
		}
	});

	it("fails fast when a module fails to execute", async () => {
		tempRoot = TempDir.createSync("@omp-python-modules-");
		const homeDir = path.join(tempRoot.path(), "home");
		const cwd = path.join(tempRoot.path(), "project");

		await writeModule(path.join(homeDir, ".omp", "agent", "modules"), "alpha.py", "user-omp");
		await writeModule(path.join(cwd, ".omp", "modules"), "beta.py", "project-omp");

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

		await expect(loadPythonModules(executor, { cwd, homeDir })).rejects.toThrow("Failed to load Python module");
	});
});
