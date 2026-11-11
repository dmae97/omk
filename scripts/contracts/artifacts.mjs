import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, lstatSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const OUTPUT = join(ROOT, "packages/protocol/src/generated/rust-contracts");
export function readRustBundle() {
	const snapshot = () =>
		Object.fromEntries(
			readdirSync(join(ROOT, "native/omk-contract/src"))
				.filter((n) => n.endsWith(".rs"))
				.sort()
				.map((n) => {
					const path = join(ROOT, "native/omk-contract/src", n);
					if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
						throw Error("unsafe Rust source link");
					return [n, readFileSync(path, "utf8")];
				}),
		);
	const before = snapshot();
	const result = spawnSync(
		"cargo",
		[
			"run",
			"--quiet",
			"--offline",
			"--locked",
			"--manifest-path",
			join(ROOT, "native/omk-contract/Cargo.toml"),
			"--bin",
			"omk-contract-gen",
		],
		{ cwd: ROOT, encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
	);
	if (result.error || result.signal || result.status !== 0)
		throw Error(`Rust contract catalog failed (exit ${result.status}): ${result.stderr}`);
	let bundle;
	try {
		bundle = JSON.parse(result.stdout);
	} catch {
		throw Error("invalid Rust contract catalog JSON");
	}
	if (
		JSON.stringify(before) !== JSON.stringify(snapshot()) ||
		JSON.stringify(Object.entries(before).sort()) !== JSON.stringify(Object.entries(bundle.files ?? {}).sort())
	)
		throw Error("Rust source changed during catalog generation");
	if (bundle.generator !== readFileSync(join(ROOT, "native/omk-contract/src/bin/omk-contract-gen.rs"), "utf8"))
		throw Error("stale compiled generator");
	return bundle;
}
export function assertOutputPath() {
	let current = ROOT;
	for (const segment of relative(ROOT, OUTPUT).split(/[\\/]/)) {
		current = join(current, segment);
		if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw Error("unsafe generated directory symlink");
	}
	return OUTPUT;
}
function inventory(dir) {
	if (!existsSync(dir)) return [];
	if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) throw Error("unsafe artifact directory");
	return readdirSync(dir)
		.sort()
		.map((name) => {
			const stat = lstatSync(join(dir, name));
			if (stat.isSymbolicLink() || !stat.isFile()) throw Error("unsafe artifact link or directory");
			return name;
		});
}
function validateNames(artifacts) {
	if (!(artifacts instanceof Map) || !artifacts.size) throw Error("empty artifact set");
	for (const [name, text] of artifacts)
		if (!/^[a-z][a-z0-9-]*(?:\.generated)?\.(?:ts|json)$/.test(name) || typeof text !== "string")
			throw Error("unsafe artifact path or content");
}
export function checkArtifacts(dir, artifacts) {
	validateNames(artifacts);
	const actual = inventory(dir);
	for (const name of actual) if (!artifacts.has(name)) throw Error(`unexpected artifact inventory: ${name}`);
	for (const [name, text] of artifacts) {
		if (!actual.includes(name)) throw Error(`missing artifact: ${name}`);
		if (readFileSync(join(dir, name), "utf8") !== text) throw Error(`declaration drift: ${name}`);
	}
	return { files: artifacts.size };
}
export function writeArtifacts(dir, artifacts) {
	validateNames(artifacts);
	const existing = inventory(dir);
	for (const name of existing) if (!artifacts.has(name)) throw Error(`unexpected artifact inventory: ${name}`);
	mkdirSync(dir, { recursive: true });
	for (const [name, text] of artifacts) {
		const temporary = join(dir, name + ".tmp");
		if (existsSync(temporary)) throw Error("unsafe existing temporary artifact");
		writeFileSync(temporary, text, { flag: "wx" });
		renameSync(temporary, join(dir, name));
	}
}
