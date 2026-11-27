#!/usr/bin/env node
/**
 * Copy coding-agent runtime assets without shx/shelljs.
 * The lockfile security gate forbids those packages, and a missing `shx` on
 * PATH made `npm run build` exit 127 after TypeScript had already succeeded.
 */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function copyFile(from, to) {
	mkdirSync(dirname(to), { recursive: true });
	copyFileSync(from, to);
}

function copyMatching(fromDir, toDir, extension) {
	const names = readdirSync(fromDir).filter((name) => name.endsWith(extension));
	if (names.length === 0) {
		throw new Error(`No ${extension} assets in ${fromDir}`);
	}
	mkdirSync(toDir, { recursive: true });
	for (const name of names) copyFile(join(fromDir, name), join(toDir, name));
}

function copyTree(from, to) {
	cpSync(from, to, { recursive: true, dereference: false });
}

/** Source layout used by `node dist/cli.js`. Binary layout sits next to the compiled executable. */
export function copyAssets(packageDir, binary = false) {
	const dist = join(packageDir, "dist");
	if (binary) {
		for (const name of ["package.json", "README.md", "CHANGELOG.md"]) {
			copyFile(join(packageDir, name), join(dist, name));
		}
		copyMatching(join(packageDir, "src/modes/interactive/theme"), join(dist, "theme"), ".json");
		copyMatching(join(packageDir, "src/modes/interactive/assets"), join(dist, "assets"), ".png");
		copyFile(join(packageDir, "src/core/export-html/template.html"), join(dist, "export-html/template.html"));
		copyMatching(join(packageDir, "src/core/export-html/vendor"), join(dist, "export-html/vendor"), ".js");
		copyTree(join(packageDir, "docs"), join(dist, "docs"));
		copyTree(join(packageDir, "examples"), join(dist, "examples"));
		copyFile(
			join(packageDir, "../../node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm"),
			join(dist, "photon_rs_bg.wasm"),
		);
		copyTree(join(packageDir, "resources"), join(dist, "resources"));
		return;
	}

	copyMatching(
		join(packageDir, "src/modes/interactive/theme"),
		join(dist, "modes/interactive/theme"),
		".json",
	);
	copyMatching(
		join(packageDir, "src/modes/interactive/assets"),
		join(dist, "modes/interactive/assets"),
		".png",
	);
	const html = join(packageDir, "src/core/export-html");
	for (const name of ["template.html", "template.css", "template.js"]) {
		copyFile(join(html, name), join(dist, "core/export-html", name));
	}
	copyMatching(join(html, "vendor"), join(dist, "core/export-html/vendor"), ".js");
	const embeddedAssetsPath = join(dist, "bun/embedded-assets.js");
	if (existsSync(embeddedAssetsPath)) {
		const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
		const themeDir = join(packageDir, "src/modes/interactive/theme");
		const themes = Object.fromEntries(
			readdirSync(themeDir)
				.filter((name) => name.endsWith(".json") && name !== "theme-schema.json")
				.sort()
				.map((name) => [name, JSON.parse(readFileSync(join(themeDir, name), "utf8"))]),
		);
		writeFileSync(
			embeddedAssetsPath,
			`export const EMBEDDED_VERSION = ${JSON.stringify(pkg.version ?? "0.0.0")};\nexport const EMBEDDED_THEMES = ${JSON.stringify(themes)};\n`,
			"utf8",
		);
	}
}

export function makeCliExecutable(packageDir) {
	const cli = join(packageDir, "dist/cli.js");
	chmodSync(cli, statSync(cli).mode | 0o111);
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
	const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
	if (process.argv.includes("--chmod-cli")) makeCliExecutable(packageDir);
	else copyAssets(packageDir, process.argv.includes("--binary"));
}
