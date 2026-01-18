import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { discoverPythonModules, loadPythonModules, type PythonModuleExecutor } from "./python-modules";

const fixturesDir = resolve(__dirname, "../../test/fixtures/python-modules");

const readFixture = (name: string): string => readFileSync(join(fixturesDir, name), "utf-8");

const writeModule = (dir: string, name: string, tag: string) => {
	mkdirSync(dir, { recursive: true });
	const base = readFixture(name);
	writeFileSync(join(dir, name), `${base}\n# ${tag}`);
};

const createTempRoot = () => mkdtempSync(join(tmpdir(), "omp-python-modules-"));

describe("python modules", () => {
	let tempRoot: string | null = null;

	afterEach(() => {
		if (tempRoot) {
			rmSync(tempRoot, { recursive: true, force: true });
		}
		tempRoot = null;
	});

	it("discovers modules with project override and sorted order", async () => {
		tempRoot = createTempRoot();
		const homeDir = join(tempRoot, "home");
		const cwd = join(tempRoot, "project");

		writeModule(join(homeDir, ".omp", "agent", "modules"), "alpha.py", "user-omp");
		writeModule(join(homeDir, ".pi", "agent", "modules"), "beta.py", "user-pi");
		writeModule(join(homeDir, ".pi", "agent", "modules"), "delta.py", "user-pi");

		writeModule(join(cwd, ".omp", "modules"), "alpha.py", "project-omp");
		writeModule(join(cwd, ".omp", "modules"), "beta.py", "project-omp");
		writeModule(join(cwd, ".pi", "modules"), "gamma.py", "project-pi");

		const modules = await discoverPythonModules({ cwd, homeDir });
		const names = modules.map((module) => basename(module.path));
		expect(names).toEqual(["alpha.py", "beta.py", "delta.py", "gamma.py"]);
		expect(modules.map((module) => ({ name: basename(module.path), source: module.source }))).toEqual([
			{ name: "alpha.py", source: "project" },
			{ name: "beta.py", source: "project" },
			{ name: "delta.py", source: "user" },
			{ name: "gamma.py", source: "project" },
		]);
		expect(modules.find((module) => module.path.endsWith("alpha.py"))?.content).toContain("project-omp");
		expect(modules.find((module) => module.path.endsWith("delta.py"))?.content).toContain("user-pi");
	});

	it("loads modules in sorted order with silent execution", async () => {
		tempRoot = createTempRoot();
		const homeDir = join(tempRoot, "home");
		const cwd = join(tempRoot, "project");

		writeModule(join(homeDir, ".omp", "agent", "modules"), "beta.py", "user-omp");
		writeModule(join(homeDir, ".omp", "agent", "modules"), "alpha.py", "user-omp");

		const calls: Array<{ name: string; options?: { silent?: boolean; storeHistory?: boolean } }> = [];
		const executor: PythonModuleExecutor = {
			execute: async (code: string, options?: { silent?: boolean; storeHistory?: boolean }) => {
				const name = code.includes("def alpha") ? "alpha" : "beta";
				calls.push({ name, options });
				return { status: "ok", cancelled: false };
			},
		};

		await loadPythonModules(executor, { cwd, homeDir });
		expect(calls.map((call) => call.name)).toEqual(["alpha", "beta"]);
		for (const call of calls) {
			expect(call.options).toEqual({ silent: true, storeHistory: false });
		}
	});

	it("fails fast when a module fails to execute", async () => {
		tempRoot = createTempRoot();
		const homeDir = join(tempRoot, "home");
		const cwd = join(tempRoot, "project");

		writeModule(join(homeDir, ".omp", "agent", "modules"), "alpha.py", "user-omp");
		writeModule(join(cwd, ".omp", "modules"), "beta.py", "project-omp");

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
