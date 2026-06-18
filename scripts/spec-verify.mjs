#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	collectSpecEvidencePaths,
	compileSpecKit,
	validateSpecKit,
	validateTaskCompletionDependencies,
} from "../packages/coding-agent/src/core/spec-kit/compiler.ts";
import { verifyHarnessControlReplay } from "../packages/coding-agent/src/core/harness-control-replay.ts";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const feature = args.find((arg) => !arg.startsWith("--")) ?? "002-harness-control-plane-v2";
const root = process.cwd();
const specPath = join(root, "specs", feature, "spec.md");
const planPath = join(root, "specs", feature, "plan.md");
const tasksPath = join(root, "specs", feature, "tasks.md");
const templatePath = join(root, "specs", "templates", "plan-template.md");
const outDir = join(root, ".omk", "runs", "spec-kit", feature);

function findLedgers(dir) {
	if (!existsSync(dir)) return [];
	const result = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const currentPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			result.push(...findLedgers(currentPath));
		} else if (entry.isFile() && entry.name === "events.jsonl" && currentPath.includes("harness-control")) {
			result.push(currentPath);
		}
	}
	return result;
}

function createTaskGateStatus(tasks, evidencePaths) {
	const taskById = new Map(tasks.map((task) => [task.id, task]));
	return tasks.map((task) => {
		const missingDeps = task.deps.filter((dep) => !taskById.get(dep)?.completed);
		const taskEvidencePaths = evidencePaths.filter((evidencePath) =>
			task.files.includes(evidencePath) || task.verify?.includes(evidencePath),
		);
		return {
			taskId: task.id,
			completed: task.completed,
			depsSatisfied: missingDeps.length === 0,
			missingDeps,
			evidencePaths: taskEvidencePaths,
			missingEvidencePaths: taskEvidencePaths.filter((evidencePath) => !existsSync(join(root, evidencePath))),
		};
	});
}

const input = {
	specMarkdown: readFileSync(specPath, "utf-8"),
	tasksMarkdown: readFileSync(tasksPath, "utf-8"),
	planMarkdown: readFileSync(planPath, "utf-8"),
	templateMarkdown: readFileSync(templatePath, "utf-8"),
};
const compiled = compileSpecKit(input);
const validation = validateSpecKit(input, compiled);
const traceabilityErrors = compiled.traceability.flatMap((entry) => {
	const errors = [];
	if (entry.taskIds.length === 0) errors.push(`traceability ${entry.requirementId} has no tasks`);
	if (entry.verifyCommands.length === 0) errors.push(`traceability ${entry.requirementId} has no verify commands`);
	if (entry.evidenceGates.length === 0) errors.push(`traceability ${entry.requirementId} has no evidence gates`);
	return errors;
});
const ledgerReports = findLedgers(join(root, ".omk", "runs")).map((ledgerPath) => ({
	ledgerPath,
	...verifyHarnessControlReplay(ledgerPath),
}));
const ledgerErrors = ledgerReports.flatMap((report) => report.errors.map((error) => `${report.ledgerPath}: ${error}`));
const evidencePaths = collectSpecEvidencePaths(compiled.tasks);
const strictEvidenceErrors = strict
	? evidencePaths
			.filter((evidencePath) => !existsSync(join(root, evidencePath)))
			.map((evidencePath) => `strict evidence missing: ${evidencePath}`)
	: [];
const completionErrors = validateTaskCompletionDependencies(compiled.tasks);
const errors = [...validation.errors, ...traceabilityErrors, ...ledgerErrors, ...strictEvidenceErrors];
const taskGateStatus = createTaskGateStatus(compiled.tasks, evidencePaths);
const report = {
	ok: errors.length === 0,
	strict,
	feature,
	specHash: compiled.specHash,
	requirements: compiled.requirements.length,
	tasks: compiled.tasks.length,
	traceability: compiled.traceability,
	evidenceManifest: compiled.evidenceManifest,
	expectedEvidencePaths: evidencePaths,
	taskGateStatus,
	completionErrors,
	ledgerReports: ledgerReports.map((report) => ({
		ledgerPath: report.ledgerPath,
		ok: report.ok,
		events: report.events.length,
		operations: report.operations.length,
		errors: report.errors,
		warnings: report.warnings,
	})),
	errors,
	warnings: validation.warnings,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, strict ? "strict-verify-report.json" : "verify-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
if (!report.ok) {
	for (const error of errors) console.error(`error: ${error}`);
	process.exit(1);
}
console.log(`spec:verify${strict ? " --strict" : ""} ok ${join(outDir, strict ? "strict-verify-report.json" : "verify-report.json")}`);
