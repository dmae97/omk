import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageDir = fileURLToPath(new URL("../../packages/coding-agent", import.meta.url));
const cli = join(packageDir, "dist/cli.js");

function fixture(t) {
	const cwd = mkdtempSync(join(tmpdir(), "neo-built-cli-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	return {
		cwd,
		run(args) {
			const result = spawnSync(process.execPath, [cli, "neo", ...args], {
				cwd,
				env: { PATH: process.env.PATH, HOME: cwd, USERPROFILE: cwd, OMK_CODING_AGENT_DIR: join(cwd, "agent"), OMK_PACKAGE_DIR: packageDir },
				encoding: "utf8",
				timeout: 30_000,
			});
			assert.ifError(result.error);
			assert.equal(result.signal, null);
			assert.equal(result.stderr, "");
			return { status: result.status, data: JSON.parse(result.stdout) };
		},
	};
}

test("built CLI lists six packaged skills without writing or claiming connections", (t) => {
	const f = fixture(t);
	const { status, data } = f.run(["list"]);
	assert.equal(status, 0);
	assert.equal(data.skills.length, 6);
	assert.ok(data.skills.every((skill) => skill.packaged));
	assert.equal(data.mcp.connected, null);
	assert.equal(data.mcp.connectionStatus, "not_probed");
	assert.deepEqual(readdirSync(f.cwd), []);
});

test("built CLI setup preview is write-free and unknown arguments fail", (t) => {
	const f = fixture(t);
	const { status, data } = f.run(["setup", "playwright", "context7"]);
	assert.equal(status, 0);
	assert.equal(data.status, "dry_run");
	assert.ok(Object.values(data.config.mcpServers).every((entry) => entry.disabled));
	assert.deepEqual(readdirSync(f.cwd), []);
	assert.equal(f.run(["setup", "--force"]).status, 1);
	assert.deepEqual(readdirSync(f.cwd), []);
});

test("built CLI applies once and preserves config on repeated setup", (t) => {
	const f = fixture(t);
	const first = f.run(["setup", "playwright", "--apply"]);
	assert.equal(first.status, 0);
	assert.equal(first.data.status, "configured_not_connected");
	const file = join(f.cwd, ".omk", "mcp.json");
	const before = readFileSync(file);
	const second = f.run(["setup", "context7", "--apply"]);
	assert.equal(second.status, 1);
	assert.equal(second.data.status, "blocked");
	assert.deepEqual(readFileSync(file), before);
	assert.deepEqual(readdirSync(join(f.cwd, ".omk")), ["mcp.json"]);
});
