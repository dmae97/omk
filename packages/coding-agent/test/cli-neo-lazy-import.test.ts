import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Spec 043: the node entry imports commands/neo-cli.ts only for `omk neo`. A resolve hook
// fails the process as soon as anything reaches for it; `neo` itself is the hook's control.
const dir = mkdtempSync(join(tmpdir(), "omk-neo-lazy-"));
const hooks = join(dir, "hooks.mjs");
const register = join(dir, "register.mjs");
writeFileSync(
	hooks,
	[
		"export async function resolve(specifier, context, next) {",
		'\tif (/(?:^|\\/)neo-cli\\.ts$/.test(specifier)) throw new Error("neo-cli loaded: " + specifier);',
		"\treturn next(specifier, context);",
		"}",
	].join("\n"),
);
writeFileSync(
	register,
	`import { register } from "node:module";\nregister(${JSON.stringify(pathToFileURL(hooks).href)});\n`,
);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const entry = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

function run(args: string[]) {
	return spawnSync(process.execPath, ["--import", pathToFileURL(register).href, entry, ...args], {
		env: { PATH: process.env.PATH, HOME: dir, OMK_CODING_AGENT_DIR: join(dir, "agent"), OMK_OFFLINE: "1" },
		encoding: "utf8",
		timeout: 30_000,
	});
}

describe("node entry loads neo-cli only for omk neo", () => {
	it("answers --help without loading neo-cli", () => {
		const result = run(["--help"]);
		expect(result.stderr).not.toContain("neo-cli loaded");
		expect(result.status).toBe(0);
	});

	it("still loads neo-cli for omk neo", () => {
		const result = run(["neo", "--help"]);
		expect(result.stderr).toContain("neo-cli loaded");
	});
});
