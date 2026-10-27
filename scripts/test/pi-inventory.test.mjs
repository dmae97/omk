import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SCRIPT = new URL("../pi-inventory.mjs", import.meta.url).pathname;
const FIX = new URL("./fixtures/pi-inventory/", import.meta.url).pathname;

// Strip GIT_* (set by git hooks) so the temp repo never touches the real index.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

function setup() {
	const root = mkdtempSync(join(tmpdir(), "pi-inv-"));
	mkdirSync(join(root, "src"));
	for (const f of readdirSync(FIX).filter((f) => f.endsWith(".txt"))) cpSync(join(FIX, f), join(root, "src", f.slice(0, -4)));
	const git = (...a) => execFileSync("git", ["-C", root, ...a], { env: cleanEnv });
	git("init", "-q");
	git("add", ".");
	const out = join(root, "inv.json");
	const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { env: { ...cleanEnv, PI_INVENTORY_ROOT: root, PI_INVENTORY_OUT: out }, encoding: "utf8" });
	return { root, out, run };
}

test("pi-inventory catches static, type-only, dynamic, require and re-export", () => {
	const { root, out, run } = setup();
	try {
		assert.equal(run().status, 0);
		const inv = JSON.parse(readFileSync(out, "utf8"));
		const got = inv.imports.map((i) => `${i.kind} ${i.specifier}`).sort();
		assert.deepEqual(got, [
			"dynamic @earendil-works/pi-tui",
			"re-export @oh-my-pi/pi-coding-agent",
			"require @mariozechner/clipboard",
			"static @mariozechner/pi-agent-core",
			"type-only @mariozechner/pi-ai",
		]);
		assert.equal(run("--check").status, 0);
		// drop one expected entry -> --check must fail
		inv.imports.pop();
		writeFileSync(out, JSON.stringify(inv, null, "\t") + "\n");
		const r = run("--check");
		assert.equal(r.status, 1);
		assert.match(r.stderr, /differs/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("pi-inventory discovers .mts/.cts/.tsx/.mjs via git ls-files and skips non-code files", () => {
	const { root, out, run } = setup();
	try {
		// Build specifiers at runtime so this file itself does not show up in the real inventory.
		const S = (n) => ["@mariozechner", `pi-x-${n}`].join("/");
		const imp = (p) => `import { x } from "${p}";\nexport const y = x;\n`;
		writeFileSync(join(root, "src", "e.mts"), imp(S("mts")));
		writeFileSync(join(root, "src", "f.cts"), imp(S("cts")));
		writeFileSync(join(root, "src", "g.tsx"), imp(S("tsx")));
		writeFileSync(join(root, "src", "h.mjs"), imp(S("mjs")));
		writeFileSync(join(root, "src", "notes.md"), imp(S("md")));
		writeFileSync(join(root, "src", "untracked.ts"), imp(S("untracked")));
		execFileSync("git", ["-C", root, "add", "src/e.mts", "src/f.cts", "src/g.tsx", "src/h.mjs", "src/notes.md"], { env: cleanEnv });
		assert.equal(run().status, 0);
		const specs = JSON.parse(readFileSync(out, "utf8")).imports.map((i) => i.specifier);
		for (const s of [S("mts"), S("cts"), S("tsx"), S("mjs")]) assert.ok(specs.includes(s), s);
		assert.ok(!specs.includes(S("md")));
		assert.ok(!specs.includes(S("untracked")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
