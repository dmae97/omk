#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCorpus, selectCorpus, verifyCorpusReport } from "./lib/harness-corpus.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/coding-agent");
const corpusPath = join(root, "specs/121-evidence-driven-harness/corpus.json");
/** @param {string} path */
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
let evidence;
try {
	if (process.argv.length !== 2) throw new Error("invalid_options");
	const corpus = parseCorpus(JSON.parse(readFileSync(corpusPath, "utf8")));
	const cases = selectCorpus(corpus);
	const files = [...new Set(cases.map(({ file }) => file))];
	const pattern = `^(?:${cases.map(({ name }) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`;
	const before = Object.fromEntries(files.map((file) => [file, digest(resolve(packageRoot, file))]));
	const corpusDigest = digest(corpusPath);
	evidence = mkdtempSync(join(tmpdir(), "omk-harness-corpus-"));
	const resultPath = join(evidence, "vitest.json");
	const run = spawnSync(process.execPath, [
		join(root, "node_modules/vitest/dist/cli.js"), "--run", ...files,
		"--maxWorkers=1", "--no-file-parallelism", "--testNamePattern", pattern,
		"--reporter=json", "--outputFile", resultPath,
	], { cwd: packageRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
	writeFileSync(join(evidence, "vitest.log"), `${run.stdout ?? ""}\n${run.stderr ?? ""}`);
	if (run.error || run.status !== 0 || run.signal) throw new Error("vitest_failed");
	const counts = verifyCorpusReport(corpus, JSON.parse(readFileSync(resultPath, "utf8")), packageRoot);
	if (digest(corpusPath) !== corpusDigest || files.some((file) => before[file] !== digest(resolve(packageRoot, file)))) {
		throw new Error("corpus_changed_during_run");
	}
	console.log(JSON.stringify({
		schemaVersion: "omk-harness-corpus-report-1", status: "passed", baseline: corpus.baseline,
		corpusSha256: corpusDigest, ...counts, cases: cases.map(({ id }) => id), testFileSha256: before,
		coverage: "selected synthetic cases only", modelSafetyClaim: false, runtimeBuild: "not-performed",
	}, null, 2));
	rmSync(evidence, { recursive: true, force: true });
} catch (error) {
	const code = error instanceof Error && /^[a-z_]+(?::[A-Za-z0-9-]+)?$/u.test(error.message)
		? error.message : "invalid_input_or_report";
	console.error(`FAIL: harness corpus (${code})${evidence ? `; local diagnostics: ${evidence}` : ""}`);
	process.exitCode = 1;
}
