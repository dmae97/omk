import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Bun standalone executables do not read on-disk package.json at runtime unless
// built with --compile-autoload-package-json. Without it, installed extension
// dependencies lose `main` and `exports` resolution (for example
// require("pkg/cjs") from a project node_modules package).
const FLAG = "--compile-autoload-package-json";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function compileCommands() {
	const shell = readFileSync(join(root, "scripts", "build-binaries.sh"), "utf8");
	const manifest = JSON.parse(readFileSync(join(root, "packages", "coding-agent", "package.json"), "utf8"));
	const fromShell = shell.split("\n").filter((line) => /\bbun build\b.*--compile\b/.test(line) && !line.trim().startsWith("#"));
	const fromScript = manifest.scripts["build:binary"].split("&&").filter((part) => /\bbun build\b.*--compile\b/.test(part));
	return [...fromShell.map((line) => ["build-binaries.sh", line]), ...fromScript.map((part) => ["build:binary", part])];
}

/** Compile flags from the release script, excluding cross-compilation target selection. */
function releaseCompileFlags() {
	const [, line] = compileCommands().find(([source, text]) => source === "build-binaries.sh" && !text.includes("omk.exe"));
	return line
		.trim()
		.split(/\s+/)
		.filter((token) => token.startsWith("--") && !token.startsWith("--target") && !token.startsWith("--outfile"));
}

describe("Bun compiled executables resolve installed package.json", () => {
	it("every release and local compile command enables runtime package.json loading", () => {
		const commands = compileCommands();
		assert(commands.length >= 3, `expected release and local compile commands, found ${commands.length}`);
		for (const [source, command] of commands) {
			assert(command.includes(FLAG), `${source} compile command lacks ${FLAG}: ${command.trim()}`);
			assert(!command.includes(`--no-${FLAG.slice(2)}`), `${source} disables runtime package.json loading`);
		}
	});

	const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
	it("a binary built with the release flags resolves main, exports and nested CJS subpaths", { skip: bun.status !== 0 && "bun is not installed" }, () => {
		const work = mkdtempSync(join(tmpdir(), "omk-bun-package-json-"));
		try {
			const project = join(work, "project");
			const write = (path, text) => {
				mkdirSync(dirname(join(project, path)), { recursive: true });
				writeFileSync(join(project, path), text);
			};
			write("node_modules/main-only/package.json", JSON.stringify({ name: "main-only", main: "lib/x.cjs" }));
			write("node_modules/main-only/lib/x.cjs", 'exports.id = "main-only";');
			write(
				"node_modules/@scope/pkg/package.json",
				JSON.stringify({ name: "@scope/pkg", type: "module", exports: { ".": "./index.mjs", "./cjs": "./index.cjs" } }),
			);
			write("node_modules/@scope/pkg/index.mjs", 'export const id = "esm";');
			write("node_modules/@scope/pkg/index.cjs", 'exports.id = "cjs-subpath";');
			write("node_modules/consumer/package.json", JSON.stringify({ name: "consumer", main: "entry.cjs" }));
			write("node_modules/consumer/entry.cjs", 'module.exports = require("@scope/pkg/cjs");');
			const entry = join(work, "probe.mjs");
			writeFileSync(
				entry,
				[
					'import { createRequire } from "node:module";',
					'import { pathToFileURL } from "node:url";',
					'const require = createRequire(pathToFileURL(process.argv[2] + "/route.mjs").href);',
					'const out = {};',
					'for (const id of ["main-only", "@scope/pkg/cjs", "consumer"]) {',
					"\ttry { out[id] = require(id).id; } catch (error) { out[id] = `error: ${error.message.split(\"\\n\")[0]}`; }",
					"}",
					"console.log(JSON.stringify(out));",
				].join("\n"),
			);
			const executable = join(work, "probe");
			const build = spawnSync("bun", ["build", "--compile", ...releaseCompileFlags(), entry, "--outfile", executable], { encoding: "utf8" });
			assert.equal(build.status, 0, build.stderr);
			const result = spawnSync(executable, [project], { cwd: project, encoding: "utf8" });
			assert.equal(result.status, 0, result.stderr);
			assert.deepEqual(JSON.parse(result.stdout.trim()), { "main-only": "main-only", "@scope/pkg/cjs": "cjs-subpath", consumer: "cjs-subpath" });
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	});
});
