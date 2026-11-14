import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, openSync, closeSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const PACKAGES = ["ai", "tui", "agent", "protocol", "adaptorch-wpl", "coding-agent", "book-to-skill"];
export const DEFAULT_APPROVED_ROOT = "/mnt/omkdata/tmp/opencode";
// OMK_ARTIFACT_WORK_ROOT relocates the owned work root (CI and tests); it must be an absolute, normalized, non-root path.
export function approvedRoot() {
	const root = process.env.OMK_ARTIFACT_WORK_ROOT || DEFAULT_APPROVED_ROOT;
	assert(isAbsolute(root) && resolve(root) === root && root !== sep, `unsafe approved work root: ${root}`);
	return root;
}
// default-omitted: legacy import with no dialect flag must fail like "missing" (OMK 2.0 native default).
export const CASES = ["native", "missing", "installed", "default-omitted", "compat-explicit"];
export const FAILING_CASES = new Set(["missing", "default-omitted"]);
export const digest = (value) => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
export const fileDigest = (path) => digest(readFileSync(path));
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 }); }
export function contained(root, path) {
	assert(path === root || path.startsWith(`${root}${sep}`), `unsafe path outside owned root: ${path}`);
	return path;
}
export function assertWork(work, source, fresh = false) {
	const root = approvedRoot();
	assert(isAbsolute(work) && resolve(work) === work && work !== root, "unsafe work root");
	contained(realpathSync(root), realpathSync(dirname(work)));
	contained(root, work);
	assert(!source.startsWith(`${work}/`) && !work.startsWith(`${source}/`) && work !== source, "work must be external to source and its ancestors");
	if (fresh) assert(!existsSync(work), "work root must be fresh, not existing");
	else assert(statSync(work).uid === process.getuid() && !lstatSync(work).isSymbolicLink(), "work root is not exclusively owned");
}
export function assertFiles(root, records) {
	assert(Array.isArray(records) && records.length > 0, "missing file digest receipt");
	for (const row of records) {
		const path = contained(resolve(root), resolve(root, row.path));
		assert(!isAbsolute(row.path) && !row.path.split("/").includes(".."), "unsafe receipt path");
		contained(realpathSync(root), realpathSync(path));
		assert.equal(fileDigest(path), row.sha256, `file digest changed: ${row.path}`);
	}
}
export function assertPackage(path, expected, prefix) {
	contained(realpathSync(prefix), realpathSync(path));
	const manifest = readJson(join(path, "package.json"));
	assert.equal(manifest.name, expected.name, "installed package identity mismatch");
	assert.equal(manifest.version, expected.version, "installed package identity version mismatch");
	assertFiles(path, expected.files);
	return { name: manifest.name, version: manifest.version, path: realpathSync(path), files: expected.files, sha256: digest(expected.files) };
}
export function walk(root, visit, skip = () => false) {
	for (const name of readdirSync(root).sort()) {
		const path = join(root, name);
		if (skip(path)) continue;
		const stat = lstatSync(path);
		visit(path, stat);
		if (stat.isDirectory()) walk(path, visit, skip);
	}
}
export function tree(root, includeDependencies = false) {
	const files = [];
	walk(root, (path, stat) => { if (stat.isFile()) files.push({ path: relative(root, path), sha256: fileDigest(path) }); }, (path) => !includeDependencies && path.split(sep).at(-1) === "node_modules");
	return files;
}
export function assertNoLinksOutside(root, allowMissing = false) {
	walk(root, (path, stat) => {
		if (!stat.isSymbolicLink()) return;
		const target = contained(realpathSync(root), resolve(dirname(path), readlinkSync(path)));
		if (!allowMissing || existsSync(target)) contained(realpathSync(root), realpathSync(target));
	});
}
export function isolatedEnv(root, inherited = process.env) {
	return { PATH: inherited.PATH, HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "home", ".config"), XDG_CACHE_HOME: join(root, "home", ".cache"), TMPDIR: root,
		OMK_CODING_AGENT_DIR: join(root, "agent"), OMK_OFFLINE: "1", OMK_TRUST_PROJECT: "1", OMK_SKIP_VERSION_CHECK: "1", NO_COLOR: "1", CI: "1",
		NPM_CONFIG_USERCONFIG: "/dev/null", NPM_CONFIG_GLOBALCONFIG: join(root, "npm-globalrc"), NPM_CONFIG_CACHE: join(root, "npm-cache"), NPM_CONFIG_OFFLINE: "true", NPM_CONFIG_IGNORE_SCRIPTS: "true" };
}
export function run(command, args, cwd, work, label, options = {}) {
	const logs = ["stdout", "stderr"].map((kind) => join(work, `${label}.${kind}.log`));
	const handles = logs.map((path) => openSync(path, "wx", 0o600));
	let result;
	try { result = spawnSync(command, args, { cwd, env: isolatedEnv(work), input: "", timeout: 900_000, ...options, stdio: ["pipe", ...handles] }); }
	finally { for (const handle of handles) closeSync(handle); }
	const receipt = { command: [command, ...args], cwd, status: result.status, signal: result.signal, logs: logs.map((path) => ({ path: relative(work, path), sha256: fileDigest(path) })) };
	writeJson(join(work, `${label}.command.json`), receipt);
	assert(!result.error && result.status === 0 || options.allowFailure, `${label} failed (${result.status}): ${result.error?.message ?? "see full logs"}; ${logs.join(" ")}`);
	return { ...receipt, stdout: readFileSync(logs[0], "utf8"), stderr: readFileSync(logs[1], "utf8") };
}
export function inputs(source) {
	const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: source, encoding: "utf8", maxBuffer: 16_777_216 }).split("\0").filter(Boolean);
	return [...new Set(paths)].sort().filter((path) => /^(packages\/|scripts\/|\.omk\/(extensions|skills|prompts)\/|(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|biome\.json|LICENSE|NOTICE|README\.md|CHANGELOG\.md|AGENTS\.md|SKILLS\.md|\.gitignore)$)/.test(path))
		.filter((path) => !/(^|\/)(?:node_modules|dist|dist\.bak|dist-chrome|dist-firefox|\.git|sessions|\.cache|coverage|\.turbo|__pycache__)(\/|$)|\.tsbuildinfo$|\.log$|\.bak(?:-|$)|(^|\/)(?:\.env|\.npmrc|auth\.json|credentials\.json)|\.(pem|key|p12|pfx)$|(^|\/)corpus(\/|$)/i.test(path) && existsSync(join(source, path)))
		.map((path) => { assert(lstatSync(join(source, path)).isFile(), `source link/special file requires review: ${path}`); return { path, sha256: fileDigest(join(source, path)), mode: statSync(join(source, path)).mode & 0o777 }; });
}
export function auditMembers(members, verbose, publicSources = []) {
	assert(members.length > 0, "missing public tarball members");
	for (const path of members) {
		assert(path.startsWith("package/") && !path.split("/").includes("..") && !path.includes("\\"), `unsafe tarball member: ${path}`);
		assert(!/(^|\/)(?:\.git|\.omk|\.pi|\.npmrc|\.env[^/]*|sessions|caches?|corpus|auth\.json)(\/|$)|\.(pem|p12|key)$/i.test(path), `private tarball member: ${path}`);
		const module = path.match(/^package\/dist\/(.+)\.(?:js|d\.ts)(?:\.map)?$/);
		assert(!/(^|\/)session(\/|$)/i.test(path) || module && publicSources.includes(`src/${module[1]}.ts`), `unbound session tarball member: ${path}`);
		assert(/^package\/(dist|docs|examples|resources|skills|vendor|native)(\/|$)|^package\/(package\.json|npm-shrinkwrap\.json|LICENSE|NOTICE|README\.md|CHANGELOG\.md|DEVIN-NOTICE|containerization\.md|upstream\.json)$/.test(path.replace(/\/$/, "")), `non-public tarball member: ${path}`);
	}
	assert(verbose.every((line) => /^[d-]/.test(line)), "tarball contains link or special type");
}
export function assertLocked(actual, reviewed, tarballs, base = process.cwd()) {
	const reviewedRows = Object.entries(reviewed.packages).filter(([, row]) => !row.link);
	for (const [path, row] of Object.entries(actual.packages)) {
		if (!path) continue;
		const name = path.split("node_modules/").at(-1);
		const internal = tarballs.find((item) => item.name === name);
		if (internal) {
			assert(row.version === internal.version && row.resolved?.startsWith("file:") && resolve(base, row.resolved.slice(5)) === internal.path && !row.link, `internal resolution is not the exact tarball: ${path}`);
		} else assert(reviewedRows.some(([key, item]) => key.split("node_modules/").at(-1) === name && item.version === row.version && item.integrity && item.integrity === row.integrity && item.resolved === row.resolved), `unreviewed locked dependency: ${name}@${row.version}; human review required`);
	}
}
export function checkCandidate(work) {
	const receipt = readJson(join(work, "candidate.json"));
	assertWork(work, receipt.source);
	assert.equal(receipt.source, realpathSync(resolve(import.meta.dirname, "..")), "wrong source checkout origin");
	assert(receipt.work === work && receipt.snapshot === join(work, "candidate"), "mismatched owned snapshot/work receipt");
	contained(realpathSync(work), realpathSync(receipt.snapshot));
	assert.equal(digest(receipt.inputs), receipt.candidate, "input receipt digest mismatch");
	assert.equal(digest(receipt.outputs), receipt.outputsDigest, "output receipt digest mismatch");
	assert.equal(digest(inputs(receipt.source)), receipt.candidate, "frozen source candidate changed");
	assertFiles(receipt.snapshot, receipt.inputs);
	assertFiles(receipt.snapshot, receipt.outputs);
	assertFiles(receipt.snapshot, receipt.dependencies);
	for (const tarball of receipt.tarballs) { contained(join(work, "tarballs"), realpathSync(tarball.path)); assert.equal(fileDigest(tarball.path), tarball.sha256, "candidate tarball digest changed"); }
	assertNoLinksOutside(receipt.snapshot);
	return receipt;
}
export function prepare(source, work, frozen) {
	assertWork(work, source, true);
	const files = inputs(source);
	assert(/^[a-f0-9]{64}$/.test(frozen ?? "") && digest(files) === frozen, "explicit candidate-freeze input digest required; do not snapshot a mutable candidate");
	mkdirSync(work, { mode: 0o700 });
	const snapshot = join(work, "candidate");
	mkdirSync(snapshot);
	for (const row of files) { const target = join(snapshot, row.path); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(source, row.path), target, constants.COPYFILE_FICLONE); }
	const dependencyDirs = ["node_modules", ...files.filter((row) => row.path.startsWith("packages/") && row.path.endsWith("/package.json")).map((row) => join(dirname(row.path), "node_modules"))];
	for (const path of dependencyDirs) if (existsSync(join(source, path))) cpSync(join(source, path), join(snapshot, path), { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
	walk(snapshot, (path, stat) => {
		if (!stat.isSymbolicLink()) return;
		const link = readlinkSync(path);
		if (isAbsolute(link)) { contained(source, link); unlinkSync(path); symlinkSync(relative(dirname(path), join(snapshot, relative(source, link))), path); }
	});
	assertNoLinksOutside(snapshot, true);
	assertFiles(snapshot, files);
	assert.equal(digest(inputs(source)), frozen, "source changed during snapshot");
	const reviewedLock = readJson(join(snapshot, "package-lock.json"));
	const dependencies = [];
	walk(snapshot, (path, stat) => {
		if (!stat.isFile() || !/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package.json$/.test(path)) return;
		const pkg = readJson(path);
		assert(Object.entries(reviewedLock.packages).some(([key, row]) => !row.link && key.split("node_modules/").at(-1) === pkg.name && row.version === pkg.version), `existing installed build dependency is not reviewed/pinned: ${pkg.name}@${pkg.version}`);
		dependencies.push({ path: relative(snapshot, path), sha256: fileDigest(path) });
	});
	for (const dir of PACKAGES) {
		const pkg = readJson(join(snapshot, "packages", dir, "package.json"));
		assert(pkg.name === (dir === "coding-agent" ? "open-multi-agent-kit" : dir === "agent" ? "omk-agent-core" : `omk-${dir}`) && pkg.version === "1.5.10" && pkg.license === "MIT", "unreviewed local candidate manifest");
		assert(!["preinstall", "install", "postinstall", "prepare"].some((name) => pkg.scripts?.[name]), "unexpected lifecycle requires review before build");
	}
	for (const dir of ["home", "agent", "tarballs", "unpacked"]) mkdirSync(join(work, dir));
	const tools = { node: { version: process.version, path: realpathSync(process.execPath), sha256: fileDigest(process.execPath) }, npm: run("npm", ["--version"], snapshot, work, "npm-version").stdout.trim() };
	const build = run("npm", ["run", "build"], snapshot, work, "candidate-build");
	assertNoLinksOutside(snapshot);
	const outputs = tree(join(snapshot, "packages")).filter((row) => row.path.includes("/dist/")).map((row) => ({ ...row, path: `packages/${row.path}` }));
	assert(outputs.length > 0, "missing fresh emitted outputs");
	const tarballs = PACKAGES.map((dir) => {
		const packageDir = join(snapshot, "packages", dir);
		const manifest = readJson(join(packageDir, "package.json"));
		assert(manifest.version === "1.5.10" && manifest.license === "MIT", `unreviewed candidate package: ${manifest.name}`);
		assert(!["preinstall", "install", "postinstall", "prepare"].some((name) => manifest.scripts?.[name]), "unexpected package lifecycle requires review");
		const pack = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", join(work, "tarballs")], packageDir, work, `pack-${dir}`);
		const packed = JSON.parse(pack.stdout)[0];
		const path = contained(join(work, "tarballs"), resolve(work, "tarballs", packed.filename));
		const members = run("tar", ["-tzf", path], work, work, `members-${dir}`).stdout.trim().split("\n");
		const verbose = run("tar", ["-tvzf", path], work, work, `member-types-${dir}`).stdout.trim().split("\n");
		auditMembers(members, verbose, files.filter((row) => row.path.startsWith(`packages/${dir}/src/`)).map((row) => row.path.slice(`packages/${dir}/`.length)));
		const unpack = join(work, "unpacked", dir); mkdirSync(unpack);
		run("tar", ["-xzf", path, "--no-same-owner", "-C", unpack], work, work, `extract-${dir}`);
		assert(/MIT|Permission is hereby granted/.test(readFileSync(join(unpack, "package", "LICENSE"), "utf8")), "missing MIT license notice");
		return { name: manifest.name, version: manifest.version, dir, path, sha256: fileDigest(path), files: tree(join(unpack, "package")) };
	});
	const receipt = { schema: 1, work, source, snapshot, candidate: frozen, head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim(), inputs: files, dependencies, tools, outputs, outputsDigest: digest(outputs), tarballs, build, reviewedLock };
	writeJson(join(work, "candidate.json"), receipt);
	checkCandidate(work);
	return receipt;
}
export function copyNpmCache(work, inherited = process.env) {
	const cache = join(inherited.npm_config_cache ?? inherited.NPM_CONFIG_CACHE ?? join(inherited.HOME, ".npm"), "_cacache");
	assert(existsSync(cache), "existing npm cache unavailable; no network fallback is authorized");
	cpSync(cache, join(work, "npm-cache", "_cacache"), { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
	assertNoLinksOutside(join(work, "npm-cache"));
}
export function consumerLock(candidate, manifest) {
	const packages = { "": structuredClone(manifest) };
	for (const [path, row] of Object.entries(candidate.reviewedLock.packages)) {
		if (path.startsWith("node_modules/") && !row.link) packages[path] = structuredClone(row);
	}
	for (const tarball of candidate.tarballs) {
		const workspacePath = `packages/${tarball.dir}`;
		const workspace = candidate.reviewedLock.packages[workspacePath];
		assert(workspace?.name === tarball.name && workspace.version === tarball.version, `workspace lock identity mismatch: ${tarball.name}`);
		const row = structuredClone(workspace);
		delete row.devDependencies;
		packages[`node_modules/${tarball.name}`] = { ...row, resolved: `file:${tarball.path}` };
		for (const [path, dependency] of Object.entries(candidate.reviewedLock.packages)) {
			if (path.startsWith(`${workspacePath}/node_modules/`) && !dependency.link) packages[`node_modules/${tarball.name}${path.slice(workspacePath.length)}`] = structuredClone(dependency);
		}
	}
	const lock = { name: manifest.name, lockfileVersion: 3, requires: true, packages };
	assertLocked(lock, candidate.reviewedLock, candidate.tarballs);
	return lock;
}
export function installConsumer(work) {
	const candidate = checkCandidate(work);
	const prefix = join(work, "consumer");
	assert(!existsSync(prefix), "consumer prefix must be fresh");
	mkdirSync(prefix);
	const manifest = { name: "native-artifact-consumer", private: true, type: "module", dependencies: Object.fromEntries(candidate.tarballs.map((row) => [row.name, `file:${row.path}`])) };
	writeJson(join(prefix, "package.json"), manifest);
	const lock = consumerLock(candidate, manifest);
	writeJson(join(prefix, "npm-shrinkwrap.json"), lock);
	copyNpmCache(work);
	run("npm", ["--prefix", prefix, "ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--workspaces=false", "--omit=dev"], prefix, work, "consumer-install");
	assertLocked(readJson(join(prefix, "npm-shrinkwrap.json")), candidate.reviewedLock, candidate.tarballs, prefix);
	if (existsSync(join(prefix, "node_modules/.package-lock.json"))) assertLocked(readJson(join(prefix, "node_modules/.package-lock.json")), candidate.reviewedLock, candidate.tarballs, prefix);
	assertNoLinksOutside(prefix);
	const resolved = [];
	walk(join(prefix, "node_modules"), (path, stat) => {
		if (!stat.isFile() || !path.endsWith("/package.json")) return;
		const manifest = readJson(path);
		const expected = candidate.tarballs.find((row) => row.name === manifest.name);
		if (expected) resolved.push(assertPackage(dirname(path), expected, prefix));
	});
	assert.equal(new Set(resolved.map((row) => row.name)).size, 7, "seven exact installed packages required");
	writeJson(join(work, "installed.json"), { candidate: candidate.candidate, prefix, lock, resolved });
	return { candidate, prefix, resolved };
}
