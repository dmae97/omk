import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const core = "@opentui/core";
const nativeFiles = { darwin: "libopentui.dylib", linux: "libopentui.so", win32: "opentui.dll" };

function nativeTarget(target) {
	const match = /^(linux|darwin|windows)-(x64|arm64)$/.exec(target);
	assert(match, `Unsupported OpenTUI target: ${target}`);
	const os = match[1] === "windows" ? "win32" : match[1];
	return { os, cpu: match[2], name: `${core}-${os}-${match[2]}` };
}

function dependencyPath(packages, parent, name) {
	for (let scope = parent; scope; scope = scope.slice(0, Math.max(0, scope.lastIndexOf("/node_modules/")))) {
		const path = `${scope}/node_modules/${name}`;
		if (Object.hasOwn(packages, path)) return path;
	}
	const path = `node_modules/${name}`;
	return Object.hasOwn(packages, path) ? path : undefined;
}

export function projectOpenTuiLock(lock, pin, target) {
	const native = nativeTarget(target);
	const dependencies = { [core]: pin, [native.name]: pin };
	const root = { name: "omk-opentui-runtime", private: true, dependencies };
	const packages = { "": root };
	function visit(path) {
		if (Object.hasOwn(packages, path)) return;
		const row = lock.packages[path];
		assert(!row?.link && row?.integrity && row.resolved?.startsWith("https://"), `Missing locked archive: ${path}`);
		packages[path] = row;
		for (const name of Object.keys({ ...row.dependencies, ...row.optionalDependencies, ...row.peerDependencies })) {
			const child = dependencyPath(lock.packages, path, name);
			if (child) visit(child);
			else assert(row.peerDependenciesMeta?.[name]?.optional, `Missing locked dependency: ${path} -> ${name}`);
		}
	}
	for (const [name, version] of Object.entries(dependencies)) {
		const path = `node_modules/${name}`;
		assert(version && lock.packages[path]?.version === version, `OpenTUI pin differs from lock: ${name}`);
		visit(path);
	}
	return { name: root.name, lockfileVersion: lock.lockfileVersion, requires: true, packages };
}

function stage(target, destination, offline) {
	const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
	const pin = read("../packages/coding-agent/package.json").optionalDependencies[core];
	const lock = projectOpenTuiLock(read("../package-lock.json"), pin, target);
	const native = nativeTarget(target);
	const work = mkdtempSync(join(dirname(destination), ".omk-opentui-"));
	try {
		writeFileSync(join(work, "package.json"), JSON.stringify(lock.packages[""]));
		writeFileSync(join(work, "package-lock.json"), JSON.stringify(lock));
		const args = ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--omit=optional", "--no-bin-links", "--workspaces=false"];
		// Cross-builds install the locked target package without running it on the host.
		if (native.os !== process.platform || native.cpu !== process.arch) args.push("--force");
		if (offline) args.push("--offline");
		const npmCli = process.env.npm_execpath;
		execFileSync(npmCli ? process.execPath : "npm", npmCli ? [npmCli, ...args] : args, { cwd: work, stdio: "inherit" });
		const modules = join(work, "node_modules");
		assert(lstatSync(join(modules, native.name, nativeFiles[native.os])).isFile());
		assert(lstatSync(join(modules, core, "testing.bun.js")).isFile());
		for (const entry of readdirSync(modules)) {
			if (!entry.startsWith(".")) cpSync(join(modules, entry), join(destination, "node_modules", entry), { recursive: true });
		}
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const [target, destination, offline = "false"] = process.argv.slice(2);
	assert(target && destination && ["true", "false"].includes(offline), "Expected target, destination and optional offline flag");
	const host = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
	stage(target === "host" ? host : target, resolve(destination), offline === "true");
}
