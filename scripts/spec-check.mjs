#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileSpecKit, validateSpecKit } from "../packages/coding-agent/src/core/spec-kit/compiler.ts";

const feature = process.argv[2] ?? "002-harness-control-plane-v2";
const root = process.cwd();
const specPath = join(root, "specs", feature, "spec.md");
const planPath = join(root, "specs", feature, "plan.md");
const tasksPath = join(root, "specs", feature, "tasks.md");
const templatePath = join(root, "specs", "templates", "plan-template.md");

const input = {
	specMarkdown: readFileSync(specPath, "utf-8"),
	tasksMarkdown: readFileSync(tasksPath, "utf-8"),
	planMarkdown: readFileSync(planPath, "utf-8"),
	templateMarkdown: readFileSync(templatePath, "utf-8"),
};
const compiled = compileSpecKit(input);
const result = validateSpecKit(input, compiled);

for (const warning of result.warnings) {
	console.warn(`warning: ${warning}`);
}
if (!result.ok) {
	for (const error of result.errors) {
		console.error(`error: ${error}`);
	}
	process.exit(1);
}

console.log(`spec:check ok (${compiled.requirements.length} requirements, ${compiled.tasks.length} tasks)`);
