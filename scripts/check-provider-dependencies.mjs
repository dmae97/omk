#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

export function verifyBundle(manifest, lock, reviewText, notices, approval) {
	const review = JSON.parse(reviewText);
	if (hash(reviewText) !== approval.reviewSha256 || hash(notices) !== approval.noticesSha256) throw new Error("approved evidence/notices digest changed");
	const restored = lock.replace('name = "omk-providers"', 'name = "omk-k1-dependency-review"');
	if (hash(restored) !== review.lockfileSha256) throw new Error("resolved lock differs from approved graph");
	const dependencies = Object.entries(review.directDependencies).map(([name, dep]) =>
		`${name} = { version = "${dep.version}", default-features = false, features = [${dep.features.map((f) => `"${f}"`).join(", ")}] }`).join("\n");
	const actual = manifest.split("[dependencies]\n");
	if (actual.length !== 2 || actual[1].trim() !== dependencies || /\[(?:dev-dependencies|build-dependencies|features|patch[^\]]*)\]/.test(actual[0])) throw new Error("manifest differs from approved dependency features/pins");
	return review;
}

export function parseTree(output) {
	const nodes = new Map();
	const stack = [];
	for (const line of output.trim().split("\n")) {
		if (line === "[build-dependencies]") continue;
		const match = /^(\d+)([^ ]+) v([^ |]+)(?: [^|]*)?\|features=([^|]*)\|license=/.exec(line);
		if (!match) throw new Error("unrecognized Cargo tree row");
		const [, depthText, name, version, features] = match;
		const depth = Number(depthText);
		const id = depth === 0 ? "root" : `${name}@${version}`;
		if (!nodes.has(id)) nodes.set(id, { features: new Set(), dependencies: new Set() });
		for (const feature of features.split(",").filter(Boolean)) nodes.get(id).features.add(feature);
		if (depth > 0) {
			const parent = nodes.get(stack[depth - 1]);
			if (!parent) throw new Error("invalid tree depth");
			parent.dependencies.add(id);
		}
		stack[depth] = id;
		stack.length = depth + 1;
	}
	return nodes;
}

export function verifyTree(output, expected) {
	const actual = parseTree(output);
	const sort = (set) => [...set].sort();
	const same = (a, b) => JSON.stringify(sort(a)) === JSON.stringify(sort(b));
	const expectedNodes = expected.nodes.map((node) => ({ ...node, id: node.package.startsWith("omk-k1-dependency-review@") ? "root" : node.package }));
	if (!same(actual.keys(), expectedNodes.map((node) => node.id))) throw new Error("selected package set changed");
	for (const node of expectedNodes) {
		const observed = actual.get(node.id);
		if (!same(observed.features, node.features) || !same(observed.dependencies, new Set(node.dependencies.map((dep) => dep.package)))) throw new Error(`features/edges changed: ${node.id}`);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	if (args.length > 1 || args.some((arg) => arg !== "--graphs")) throw new Error("usage: check-provider-dependencies.mjs [--graphs]");
	const review = verifyBundle(read("native/omk-providers/Cargo.toml"), read("native/omk-providers/Cargo.lock"), read("specs/120-rust-core/k1-dependency-review.json"), read("native/omk-providers/THIRD-PARTY-NOTICES.md"), JSON.parse(read("specs/120-rust-core/k1-adoption.json")));
	if (args.includes("--graphs")) {
		for (const [target, expected] of Object.entries(review.platforms)) {
			const run = spawnSync("cargo", ["tree", "--locked", "--manifest-path", "native/omk-providers/Cargo.toml", "--target", target, "--edges", "normal,build", "--prefix", "depth", "--format", "{p}|features={f}|license={l}"], { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
			if (run.error || run.status !== 0) throw new Error(`graph check failed for ${target}: ${run.stderr}`);
			verifyTree(run.stdout, expected);
			console.log(`PASS resolution graph ${target} (not a native build)`);
		}
	}
	console.log("PASS: exact B1 lock, direct features and distribution notices");
}
