import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { VERSION } from "../src/config.ts";

// A resolve hook that fails the process as soon as an entry point reaches for the agent runtime.
// `--version` must answer without it; any other command must still load it (the hook's control).
const dir = mkdtempSync(join(tmpdir(), "omk-version-fast-path-"));
const hooks = join(dir, "hooks.mjs");
const register = join(dir, "register.mjs");
writeFileSync(
	hooks,
	[
		"const RUNTIME = /(?:^|\\/)(?:main|register-bedrock|register-bundled-coding-agent)\\.ts$/;",
		"export async function resolve(specifier, context, next) {",
		'\tif (RUNTIME.test(specifier)) throw new Error("runtime loaded: " + specifier);',
		"\treturn next(specifier, context);",
		"}",
	].join("\n"),
);
writeFileSync(
	register,
	`import { register } from "node:module";\nregister(${JSON.stringify(pathToFileURL(hooks).href)});\n`,
);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const entries: Record<string, string> = {
	node: fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
	bun: fileURLToPath(new URL("../src/bun/cli.ts", import.meta.url)),
};

function run(entry: string, args: string[]) {
	return spawnSync(process.execPath, ["--import", pathToFileURL(register).href, entry, ...args], {
		env: { PATH: process.env.PATH, HOME: dir, OMK_CODING_AGENT_DIR: join(dir, "agent"), OMK_OFFLINE: "1" },
		encoding: "utf8",
		timeout: 20_000,
	});
}

describe("--version fast path", () => {
	for (const [name, entry] of Object.entries(entries)) {
		it.each(["--version", "-v"])(`${name} entry answers %s without loading the agent runtime`, (flag) => {
			const result = run(entry, [flag]);
			expect(result.stderr).not.toContain("runtime loaded");
			expect(result.status).toBe(0);
			expect(result.stdout).toBe(`${VERSION}\n`);
		});

		it(`${name} entry still loads the runtime for other commands`, () => {
			const result = run(entry, ["doctor"]);
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("runtime loaded");
		});
	}
});
