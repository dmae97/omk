import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const rscript = process.env.OMK_RSCRIPT;
const binary = process.env.POLICY_TEST_BINARY;
const rOptions = { skip: rscript ? false : "OMK_RSCRIPT not set; Rust policy R controls SKIP" };
let owned;
let template;

function run(bundle, executable, r = rscript, script = "scripts/architecture/verify-rust-policy.mjs") {
	return spawnSync(process.execPath, [script, bundle, executable], {
		cwd: root,
		encoding: "utf8",
		timeout: 130_000,
		maxBuffer: 4 * 1024 * 1024,
		env: { ...process.env, OMK_RSCRIPT: r ?? "", NODE_OPTIONS: "", NODE_PATH: "" },
	});
}

function rejected(result, reason) {
	assert.equal(result.error, undefined);
	assert.notEqual(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout + result.stderr, reason);
	assert.doesNotMatch(result.stdout, /RUST_POLICY_VERIFIED/);
}

function mock(t, body) {
	const dir = mkdtempSync(join(owned, "case-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const bundle = join(dir, "bundle");
	cpSync(template, bundle, { recursive: true });
	const executable = join(dir, "mock.mjs");
	writeFileSync(executable, `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
	return { bundle, executable };
}

before(() => {
	owned = mkdtempSync(join(tmpdir(), "omk-rust-policy-"));
	template = join(owned, "bundle");
	const result = spawnSync(
		process.execPath,
		["--experimental-strip-types", "scripts/architecture/export-fixtures.mjs", template],
		{
			cwd: root,
			encoding: "utf8",
			timeout: 120_000,
		},
	);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});
after(() => {
	if (owned) rmSync(owned, { recursive: true, force: true });
});

test("required policy gate fails when R is unavailable", () => {
	rejected(run(template, process.execPath, join(owned, "missing-Rscript")), /R executable unavailable/);
});

test(
	"symlink CLI entry still requires actual verification",
	{
		skip: process.platform === "win32" ? "file symlink privilege not assumed" : false,
	},
	() => {
		const script = join(owned, "policy-link.mjs");
		symlinkSync(join(root, "scripts/architecture/verify-rust-policy.mjs"), script);
		rejected(run(template, process.execPath, join(owned, "missing-Rscript"), script), /R executable unavailable/);
	},
);

const importCode =
	"import {verifyRustPolicy} from './scripts/architecture/verify-rust-policy.mjs'; console.log(typeof verifyRustPolicy);";
for (const [name, args, input] of [
	["eval", ["--input-type=module", "-e", importCode]],
	["stdin", ["--input-type=module", "-"], importCode],
	["eval argument", ["--input-type=module", "-e", importCode, "ordinary-argument"]],
	[
		"eval argument matching CLI",
		["--input-type=module", "-e", importCode, "scripts/architecture/verify-rust-policy.mjs"],
	],
]) {
	test(`importing the controller does not execute its CLI (${name})`, () => {
		const result = spawnSync(process.execPath, args, {
			cwd: root,
			input,
			encoding: "utf8",
			timeout: 10_000,
			env: { ...process.env, OMK_RSCRIPT: join(owned, "missing-Rscript"), NODE_OPTIONS: "", NODE_PATH: "" },
		});
		assert.equal(result.error, undefined);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.equal(result.stdout, "function\n");
		assert.equal(result.stderr, "");
	});
}

test(
	"actual Rust policy matches independent TS and R corpus",
	{
		skip: rscript && binary ? false : "OMK_RSCRIPT and POLICY_TEST_BINARY required; actual Rust/TS/R SKIP",
	},
	() => {
		const result = run(template, binary);
		assert.equal(result.error, undefined);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /R ORACLE R version/);
		assert.match(result.stdout, /RUST_POLICY_VERIFIED .*"dagCases":2214,"memoryCases":16/);
	},
);

const replay = `import {readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
const lines=['RUST_POLICY_V1'];
for (const name of ['dag','memory']) {
  const rows=readFileSync(join(process.argv[2],name+'.tsv'),'utf8').trimEnd().split('\\n').slice(1);
  for (const row of rows) {
    const r=row.split('\\t');
    lines.push(name==='dag' ? [name,r[0],r[4],r[6],r[7],r[8]].join('\\t') : [name,r[0],r[1],r[6],r[3],r[4]].join('\\t'));
  }
}`;
for (const [name, body, reason] of [
	["zero exit without receipt", "", /Rust policy output mismatch/],
	[
		"changed strategy with identical graph",
		`${replay}\nlines[1]=lines[1].replace('already-reduced','traversal'); process.stdout.write(lines.join('\\n')+'\\n');`,
		/Rust policy output mismatch/,
	],
	[
		"missing graph row",
		`${replay}\nlines.pop(); process.stdout.write(lines.join('\\n')+'\\n');`,
		/Rust policy output mismatch/,
	],
	[
		"binary changed during execution",
		`${replay}\nappendFileSync(process.argv[1],'\\n'); process.stdout.write(lines.join('\\n')+'\\n');`,
		/Rust policy inputs changed/,
	],
]) {
	test(`after genuine R pass, rejects ${name}`, rOptions, (t) => {
		const { bundle, executable } = mock(t, body);
		const result = run(bundle, executable);
		rejected(result, reason);
		assert.match(result.stdout, /PASS graphs=1107/);
		assert.doesNotMatch(result.stderr, /Invalid fixture digest|Stale source digest/);
	});
}
