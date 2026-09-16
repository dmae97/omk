import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runNeoCli } from "../../packages/coding-agent/src/commands/neo-cli.ts";
import { NEO_MCP_PRESETS, NEO_SKILL_NAMES, neoMcpConfig } from "../../packages/coding-agent/src/core/neo/catalog.ts";
import { createNeoMcpConfig } from "../../packages/coding-agent/src/core/neo/setup.ts";

const packageDir = fileURLToPath(new URL("../../packages/coding-agent", import.meta.url));
function fixture(t) {
	const cwd = mkdtempSync(join(tmpdir(), "neo-local-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const lines = [];
	return { cwd, lines, context: { cwd, packageDir, home: join(cwd, "home"), output: (line) => lines.push(line) } };
}

test("all six real skills have matching names, valid metadata and existing cross-links", () => {
	assert.equal(NEO_SKILL_NAMES.length, 6);
	for (const name of NEO_SKILL_NAMES) {
		const path = join(packageDir, "resources/neo/skills", name, "SKILL.md");
		const text = readFileSync(path, "utf8");
		assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---\\n`));
		const description = text.split("\n")[2].slice("description: ".length);
		assert.ok(description.length <= 1024);
		for (const match of text.matchAll(/\.\.\/(omk-[a-z-]+)\/SKILL\.md/g)) {
			assert.ok(existsSync(join(packageDir, "resources/neo/skills", match[1], "SKILL.md")));
		}
	}
});
test("list is read-only and never pretends offered MCPs are connected", (t) => {
	const f = fixture(t);
	assert.equal(runNeoCli(["list"], f.context), 0);
	const data = JSON.parse(f.lines[0]);
	assert.equal(data.skills.filter((skill) => skill.packaged).length, 6);
	assert.equal(data.mcp.connected, null);
	assert.equal(data.mcp.offered.length, 2);
	assert.deepEqual(readdirSync(f.cwd), []);
});
test("missing packaged assets fail list with a nonzero status", (t) => {
	const f = fixture(t);
	assert.equal(runNeoCli(["list"], { ...f.context, packageDir: f.cwd }), 1);
	assert.equal(JSON.parse(f.lines[0]).skills.filter((s) => s.packaged).length, 0);
});
test("dry run shows the target and performs zero writes", (t) => {
	const f = fixture(t);
	assert.equal(runNeoCli(["setup", "playwright", "context7", "--global"], f.context), 0);
	assert.equal(JSON.parse(f.lines[0]).status, "dry_run");
	assert.deepEqual(readdirSync(f.cwd), []);
});
test("MCP offers are pinned stdio configurations, disabled unless approved", () => {
	const result = neoMcpConfig(["playwright", "context7"], false);
	for (const value of Object.values(result.mcpServers)) {
		assert.equal(value.command, "npx");
		assert.equal(value.disabled, true);
		assert.ok(!value.args.some((arg) => arg.includes("@latest")));
	}
	assert.ok(result.mcpServers["neo-playwright"].args.includes("--sandbox"));
	assert.ok(!result.mcpServers["neo-playwright"].args.includes("--no-sandbox"));
	assert.equal(NEO_MCP_PRESETS.length, 2);
});
test("empty, unknown and duplicate presets fail before creating a directory", (t) => {
	const f = fixture(t);
	for (const ids of [[], ["missing"], ["playwright", "playwright"], ["--force"]]) {
		assert.throws(() => createNeoMcpConfig(f.cwd, ids));
	}
	assert.deepEqual(readdirSync(f.cwd), []);
});
test("apply writes the exact selected enabled entries with private permissions", (t) => {
	const f = fixture(t);
	assert.equal(runNeoCli(["setup", "playwright", "--apply"], f.context), 0);
	const file = join(f.cwd, ".omk/mcp.json");
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), neoMcpConfig(["playwright"], true));
	assert.equal(JSON.parse(f.lines[0]).status, "configured_not_connected");
	assert.deepEqual(readdirSync(join(f.cwd, ".omk")), ["mcp.json"]);
	if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
});
test("global apply uses the requested global root only", (t) => {
	const f = fixture(t);
	assert.equal(runNeoCli(["setup", "context7", "--global", "--apply"], f.context), 0);
	assert.ok(existsSync(join(f.context.home, ".omk/mcp.json")));
	assert.ok(!existsSync(join(f.cwd, ".omk/mcp.json")));
});
test("existing malformed configuration survives byte-for-byte without disclosure", (t) => {
	const f = fixture(t);
	mkdirSync(join(f.cwd, ".omk"));
	const path = join(f.cwd, ".omk/mcp.json");
	const sentinel = "PRIVATE-TEST-SENTINEL:not-json";
	writeFileSync(path, sentinel);
	assert.equal(runNeoCli(["setup", "context7", "--apply"], f.context), 1);
	assert.equal(readFileSync(path, "utf8"), sentinel);
	assert.ok(!f.lines.join("").includes(sentinel));
	assert.deepEqual(readdirSync(join(f.cwd, ".omk")), ["mcp.json"]);
});
test("symlinked configuration file is never replaced or followed", { skip: process.platform === "win32" }, (t) => {
	const f = fixture(t);
	mkdirSync(join(f.cwd, ".omk"));
	const target = join(f.cwd, "private.json");
	writeFileSync(target, "private");
	symlinkSync(target, join(f.cwd, ".omk/mcp.json"));
	assert.throws(() => createNeoMcpConfig(f.cwd, ["playwright"]));
	assert.equal(readFileSync(target, "utf8"), "private");
});
test("symlinked .omk directory is rejected without changing its target", { skip: process.platform === "win32" }, (t) => {
	const f = fixture(t);
	const other = join(f.cwd, "other");
	mkdirSync(other);
	symlinkSync(other, join(f.cwd, ".omk"), "dir");
	assert.throws(() => createNeoMcpConfig(f.cwd, ["playwright"]));
	assert.deepEqual(readdirSync(other), []);
});
test("duplicate flags and unknown commands cannot write configuration", (t) => {
	const f = fixture(t);
	for (const args of [["oops"], ["setup", "playwright", "--apply", "--apply"], ["list", "--apply"]]) {
		assert.equal(runNeoCli(args, f.context), 1);
	}
	assert.deepEqual(readdirSync(f.cwd), []);
});
test("npm and both binary packaging paths explicitly include public resources", () => {
	const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
	assert.ok(pkg.files.includes("resources"));
	assert.ok(pkg.scripts["copy-binary-assets"].includes("shx cp -r resources dist/"));
	assert.ok(readFileSync(new URL("../build-binaries.sh", import.meta.url), "utf8").includes('cp -r resources "$OUTPUT_DIR/$platform/"'));
});
