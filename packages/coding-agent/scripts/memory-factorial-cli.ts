import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runMemoryFactorial } from "./memory-factorial.ts";

function unsignedInteger(value: string): number {
	if (!/^\d+$/.test(value)) throw new Error("invalid integer argument");
	return Number(value);
}
export function memoryFactorialCli(args: string[]): string {
	const { values } = parseArgs({
		args,
		strict: true,
		allowPositionals: false,
		options: {
			tasks: { type: "string" },
			seeds: { type: "string" },
			"memory-budget": { type: "string" },
			out: { type: "string" },
		},
	});
	const directory = dirname(fileURLToPath(import.meta.url));
	const sourceFiles = [
		"memory-factorial.ts",
		"memory-factorial-protocol.ts",
		"memory-factorial-cli.ts",
		"../src/core/verified-memory-store.ts",
		"../src/core/verified-memory-source.ts",
		"../src/core/verified-memory-record.ts",
		"../src/core/verified-memory-context.ts",
		"../src/core/verified-memory-selection.ts",
		"../src/core/verified-memory-score.ts",
		"../src/core/context-budget-token-counter.ts",
		"../src/core/text-token-estimate.ts",
	];
	const sourceHashes = Object.fromEntries(
		sourceFiles.map((path) => [
			path,
			createHash("sha256")
				.update(readFileSync(resolve(directory, path)))
				.digest("hex"),
		]),
	);
	const result = runMemoryFactorial({
		tasks: values.tasks === undefined ? undefined : unsignedInteger(values.tasks),
		seeds: values.seeds?.split(",").map(unsignedInteger),
		memoryBudget: values["memory-budget"] === undefined ? undefined : unsignedInteger(values["memory-budget"]),
	});
	for (const [path, hash] of Object.entries(sourceHashes)) {
		if (
			createHash("sha256")
				.update(readFileSync(resolve(directory, path)))
				.digest("hex") !== hash
		)
			throw new Error("experiment source changed during execution");
	}
	const out =
		values.out === undefined ? mkdtempSync(join(tmpdir(), "omk-memory-factorial-report-")) : resolve(values.out);
	if (values.out !== undefined) mkdirSync(out, { mode: 0o700 });
	const report = join(out, "results.json");
	try {
		writeFileSync(report, `${JSON.stringify({ ...result, sourceHashes }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
		return report;
	} catch (error) {
		try {
			if (existsSync(report)) unlinkSync(report);
			rmdirSync(out);
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "report publication and cleanup failed");
		}
		throw error;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		console.log(
			JSON.stringify({ report: memoryFactorialCli(process.argv.slice(2)), kind: "offline-mechanism-check" }),
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : "memory factorial failed");
		process.exitCode = 1;
	}
}
