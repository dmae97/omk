#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

export function nativeCrates() {
	return readdirSync(join(ROOT, "native"), { withFileTypes: true })
		.filter((d) => d.isDirectory() && existsSync(join(ROOT, "native", d.name, "Cargo.toml")))
		.map((d) => join(ROOT, "native", d.name, "Cargo.toml"))
		.sort();
}

export function nativeSteps(crates) {
	return crates.flatMap((m) => [
		["fmt", "--check", "--manifest-path", m],
		["clippy", "--locked", "--manifest-path", m, "--all-targets", "--", "-D", "warnings"],
		["test", "--locked", "--manifest-path", m],
	]);
}

export function runNativeChecks({ cargo = "cargo", quiet = false } = {}) {
	const failures = [];
	for (const args of nativeSteps(nativeCrates())) {
		const label = `cargo ${args[0]} ${relative(ROOT, args[args.indexOf("--manifest-path") + 1])}`;
		const result = spawnSync(cargo, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
		if (result.error?.code === "ENOENT") return [`${label}: cargo not found; install the toolchain in rust-toolchain.toml`];
		if (result.error || result.status !== 0) {
			failures.push(`${label}: exit ${result.status ?? result.error?.message}`);
			if (!quiet) process.stderr.write(result.stdout + result.stderr);
		} else if (!quiet) console.log(`ok ${label}`);
	}
	return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const failures = runNativeChecks();
	for (const failure of failures) console.error(`FAIL ${failure}`);
	process.exitCode = failures.length ? 1 : 0;
}
