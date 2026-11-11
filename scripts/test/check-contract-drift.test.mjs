import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readRustBundle, checkArtifacts, writeArtifacts } from "../contracts/artifacts.mjs";
import { generateArtifacts } from "../contracts/typescript.mjs";

let cached;
const artifacts = () => (cached ??= generateArtifacts(readRustBundle()));
const temporary = () => mkdtempSync(join(tmpdir(), "omk-contract-drift-"));

test("declarations are deterministic from a compiled Rust source bundle", () => {
	const bundle = readRustBundle();
	assert.equal(bundle.schema, "omk.contract.sources.v1");
	const a = generateArtifacts(bundle);
	assert.deepEqual([...a], [...generateArtifacts(bundle)]);
	assert.ok(a.has("session.ts") && a.has("rpc.ts") && a.has("host-wire.ts") && a.has("wire.generated.ts"));
	assert.match(a.get("rpc-command.ts"), /RpcCommand = wire\.rpc\$command\$RpcCommand/);
	assert.match(a.get("wire.generated.ts"), /follow_up/);
	for (const [name, text] of a)
		if (name.endsWith(".ts") && name !== "wire.generated.ts" && name !== "index.ts")
			assert.doesNotMatch(text, /from "\.\/(?!wire\.generated\.ts")/, `${name} imports only the flat wire module`);
});

test("read-only drift check rejects changed, missing and extra generated artifacts", () => {
	const dir = temporary();
	const expected = artifacts();
	try {
		writeArtifacts(dir, expected);
		checkArtifacts(dir, expected);
		const path = join(dir, "session.ts");
		const before = readFileSync(path, "utf8");
		writeFileSync(path, before + "// hand edit\n");
		assert.throws(() => checkArtifacts(dir, expected), /drift|different/);
		assert.equal(readFileSync(path, "utf8"), before + "// hand edit\n");
		writeFileSync(path, before);
		rmSync(path);
		assert.throws(() => checkArtifacts(dir, expected), /missing|inventory/);
		writeFileSync(path, before);
		writeFileSync(join(dir, "unexpected.ts"), "");
		assert.throws(() => checkArtifacts(dir, expected), /unexpected|inventory/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("Rust field and enum rename changes alter generated declarations without editing TypeScript templates", () => {
	const bundle = readRustBundle();
	const changed = structuredClone(bundle);
	changed.files["host_wire.rs"] = changed.files["host_wire.rs"].replace("wire_version: u32", "protocol_revision: u32");
	const a = artifacts();
	const b = generateArtifacts(changed);
	assert.notEqual(a.get("wire.generated.ts"), b.get("wire.generated.ts"));
	assert.match(b.get("wire.generated.ts"), /protocol_revision/);
	const renamed = structuredClone(bundle);
	renamed.files["host_wire.rs"] = renamed.files["host_wire.rs"].replace(
		"    Shutdown,",
		'    #[serde(rename = "stop_host")]\n    Shutdown,',
	);
	assert.match(generateArtifacts(renamed).get("wire.generated.ts"), /stop_host/);
});

test("unsupported Rust shapes, serde attributes and custom serde changes fail closed", () => {
	for (const mutate of [
		(b) =>
			(b.files["host_wire.rs"] = b.files["host_wire.rs"].replace(
				"wire_version: u32",
				"wire_version: VecDeque<String>",
			)),
		(b) =>
			(b.files["host_wire.rs"] = b.files["host_wire.rs"].replace(
				"pub struct SpecifierAlias",
				"#[serde(deny_unknown_fields)]\npub struct SpecifierAlias",
			)),
		(b) => (b.files["session.rs"] = b.files["session.rs"].replace("Ok(Some(true))", "Ok(Some(false))")),
		(b) =>
			(b.files["host_wire.rs"] = b.files["host_wire.rs"].replace(
				"pub struct SpecifierAlias",
				'#[cfg(feature="future")]\npub struct SpecifierAlias',
			)),
		(b) =>
			(b.files["host_wire.rs"] = b.files["host_wire.rs"].replace(
				"pub struct SpecifierAlias",
				"#[serde(default)]\npub struct SpecifierAlias",
			)),
		(b) =>
			(b.files["host_wire.rs"] = b.files["host_wire.rs"].replace(
				"wire_version: u32",
				"wire_version: crate::session::String",
			)),
	]) {
		const bundle = structuredClone(readRustBundle());
		mutate(bundle);
		assert.throws(() => generateArtifacts(bundle), /unsupported|review|adapter|unknown|unresolved/i);
	}
});

test("artifact paths and symlinks cannot redirect generation outside its directory", () => {
	const dir = temporary();
	const other = temporary();
	try {
		assert.throws(() => writeArtifacts(dir, new Map([["../escape.ts", "text"]])), /path|unsafe/);
		symlinkSync(join(other, "owned.ts"), join(dir, "session.ts"));
		assert.throws(() => writeArtifacts(dir, artifacts()), /link|unsafe|inventory/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(other, { recursive: true, force: true });
	}
});
