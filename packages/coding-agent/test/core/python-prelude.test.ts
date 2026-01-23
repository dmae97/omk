import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resetPreludeDocsCache, warmPythonEnvironment } from "../../src/core/python-executor";
import { getPythonToolDescription, PythonTool } from "../../src/core/tools/python";

const resolvePythonPath = (): string | null => {
	const venvPath = process.env.VIRTUAL_ENV;
	const candidates = [venvPath, join(process.cwd(), ".venv"), join(process.cwd(), "venv")].filter(Boolean) as string[];
	for (const candidate of candidates) {
		const binDir = process.platform === "win32" ? "Scripts" : "bin";
		const exeName = process.platform === "win32" ? "python.exe" : "python";
		const pythonCandidate = join(candidate, binDir, exeName);
		if (existsSync(pythonCandidate)) {
			return pythonCandidate;
		}
	}
	return Bun.which("python") ?? Bun.which("python3");
};

const pythonPath = resolvePythonPath();
const hasKernelDeps = (() => {
	if (!pythonPath) return false;
	const result = Bun.spawnSync(
		[
			pythonPath,
			"-c",
			"import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('kernel_gateway') and importlib.util.find_spec('ipykernel') else 1)",
		],
		{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
	);
	return result.exitCode === 0;
})();

const shouldRun = Boolean(pythonPath) && hasKernelDeps;

describe.skipIf(!shouldRun)("PYTHON_PRELUDE integration", () => {
	it("exposes prelude helpers via python tool", async () => {
		const helpers = [
			"pwd",
			"env",
			"read",
			"write",
			"append",
			"mkdir",
			"rm",
			"mv",
			"cp",
			"ls",
			"cat",
			"touch",
			"find",
			"grep",
			"rgrep",
			"head",
			"tail",
			"replace",
			"sed",
			"rsed",
			"wc",
			"sort_lines",
			"uniq",
			"cols",
			"tree",
			"stat",
			"diff",
			"glob_files",
			"batch",
			"lines",
			"delete_lines",
			"delete_matching",
			"insert_at",
			"git_status",
			"git_diff",
			"git_log",
			"git_show",
			"git_file_at",
			"git_branch",
			"git_has_changes",
			"run",
			"sh",
		];

		const session = {
			cwd: process.cwd(),
			hasUI: false,
			getSessionFile: () => null,
			getSessionSpawns: () => null,
			settings: {
				getImageAutoResize: () => true,
				getLspFormatOnWrite: () => false,
				getLspDiagnosticsOnWrite: () => false,
				getLspDiagnosticsOnEdit: () => false,
				getEditFuzzyMatch: () => true,
				getBashInterceptorEnabled: () => true,
				getBashInterceptorSimpleLsEnabled: () => true,
				getBashInterceptorRules: () => [],
				getPythonToolMode: () => "ipy-only" as const,
				getPythonKernelMode: () => "per-call" as const,
			},
		};

		const tool = new PythonTool(session);
		const code = `
	helpers = ${JSON.stringify(helpers)}
	missing = [name for name in helpers if name not in globals() or not callable(globals()[name])]
	docs = __omp_prelude_docs__()
	doc_names = [d.get("name") for d in docs]
	doc_categories = [d.get("category") for d in docs]
	print("HELPERS_OK=" + ("1" if not missing else "0"))
	print("DOCS_OK=" + ("1" if "pwd" in doc_names and "Navigation" in doc_categories else "0"))
	if missing:
	    print("MISSING=" + ",".join(missing))
	`;

		const result = await tool.execute("tool-call-1", { cells: [{ code }] });
		const output = result.content.find((item) => item.type === "text")?.text ?? "";
		expect(output).toContain("HELPERS_OK=1");
		expect(output).toContain("DOCS_OK=1");
	});

	it("exposes prelude docs via warmup", async () => {
		resetPreludeDocsCache();
		const result = await warmPythonEnvironment(process.cwd(), undefined, false);
		expect(result.ok).toBe(true);
		const names = result.docs.map((doc) => doc.name);
		expect(names).toContain("pwd");
	});

	it("renders prelude docs in python tool description", async () => {
		resetPreludeDocsCache();
		const result = await warmPythonEnvironment(process.cwd(), undefined, false);
		expect(result.ok).toBe(true);
		const description = getPythonToolDescription();
		expect(description).toContain("pwd");
		expect(description).not.toContain("Documentation unavailable");
	});
});
