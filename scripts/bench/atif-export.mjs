#!/usr/bin/env node
/**
 * Spec 110: export one omk trial to an ATIF trajectory (Terminal-Bench / Harbor).
 *
 *   node scripts/bench/atif-export.mjs --events <events.jsonl> [--run-log <dir>]
 *     [--mask-env-names A,B] --out <trajectory.json>
 *
 * Runs on the host. `--mask-env-names` / `OMK_ATIF_MASK_ENV_NAMES` add secret env names from
 * the agent environment; their values are read from the exporter's own environment.
 *
 * Offline, Node built-ins only, not shipped in any package. Exit 0 ok, 1 usage/input
 * error, 2 when the post-write rescan still finds a secret (the file is removed).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTrajectory } from "./atif/map.mjs";
import { collectSecrets, maskDeep, parseNameList, rescan } from "./atif/mask.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function parseJsonl(text) {
	return text
		.split("\n")
		.filter((l) => l.trim() !== "")
		.map((l) => JSON.parse(l));
}

export function readRunLog(dir) {
	const runLog = {};
	const hashes = {};
	if (!dir || !existsSync(dir)) return { runLog, hashes };
	for (const file of readdirSync(dir).sort()) {
		if (!file.endsWith(".jsonl")) continue;
		const text = readFileSync(join(dir, file), "utf8");
		runLog[basename(file, ".jsonl")] = parseJsonl(text);
		hashes[`run-log/${file}`] = sha256(text);
	}
	return { runLog, hashes };
}

export function agentVersion() {
	return JSON.parse(readFileSync(join(repoRoot, "packages", "coding-agent", "package.json"), "utf8")).version;
}

/** Build, mask and serialize. Returns { json, hits }. */
export function exportTrajectory({ eventsText, runLogDir, env = process.env, version = agentVersion(), maskNames = [], afterMask }) {
	const events = parseJsonl(eventsText);
	const { runLog, hashes } = readRunLog(runLogDir);
	const trajectory = buildTrajectory({
		events,
		runLog,
		agentVersion: version,
		inputHashes: { events: sha256(eventsText), ...hashes },
	});
	const secrets = collectSecrets(env, maskNames);
	let masked = maskDeep(trajectory, secrets); // whole object, extra.omk.eventLog included
	if (afterMask) masked = afterMask(masked); // test-only hook to prove the rescan gate
	const json = `${JSON.stringify(masked, null, 2)}\n`;
	return { json, hits: rescan(json, secrets) };
}

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const key = argv[i];
		if (key === "--events" || key === "--run-log" || key === "--out" || key === "--mask-env-names") args[key.slice(2)] = argv[++i];
		else throw new Error(`unknown argument: ${key}`);
	}
	if (!args.events || !args.out) throw new Error("usage: atif-export.mjs --events <events.jsonl> [--run-log <dir>] [--mask-env-names A,B] --out <trajectory.json>");
	return args;
}

/** `options.afterMask` is a test-only hook (not reachable from the CLI). */
export function main(argv = process.argv.slice(2), env = process.env, options = {}) {
	let args;
	try {
		args = parseArgs(argv);
	} catch (error) {
		console.error(error.message);
		return 1;
	}
	const maskNames = parseNameList(args["mask-env-names"]);
	const { json } = exportTrajectory({
		eventsText: readFileSync(args.events, "utf8"),
		runLogDir: args["run-log"],
		env,
		maskNames,
		afterMask: options.afterMask,
	});
	writeFileSync(args.out, json);
	const hits = rescan(readFileSync(args.out, "utf8"), collectSecrets(env, maskNames));
	if (hits.length) {
		rmSync(args.out, { force: true });
		console.error(`atif-export: secret rescan found ${hits.length} hit(s) (${hits.join(", ")}); output removed`);
		return 2;
	}
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
