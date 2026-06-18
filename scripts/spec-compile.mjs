#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileSpecKit, validateSpecKit } from "../packages/coding-agent/src/core/spec-kit/compiler.ts";

const feature = process.argv[2] ?? "002-harness-control-plane-v2";
const root = process.cwd();
const specPath = join(root, "specs", feature, "spec.md");
const planPath = join(root, "specs", feature, "plan.md");
const tasksPath = join(root, "specs", feature, "tasks.md");
const templatePath = join(root, "specs", "templates", "plan-template.md");
const outDir = join(root, ".omk", "runs", "spec-kit", feature);

const input = {
	specMarkdown: readFileSync(specPath, "utf-8"),
	tasksMarkdown: readFileSync(tasksPath, "utf-8"),
	planMarkdown: readFileSync(planPath, "utf-8"),
	templateMarkdown: readFileSync(templatePath, "utf-8"),
};
const compiled = compileSpecKit(input);
const result = validateSpecKit(input, compiled);
if (!result.ok) {
	for (const error of result.errors) {
		console.error(`error: ${error}`);
	}
	process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "compiled-dag.json"), `${JSON.stringify(compiled.compiledDag, null, 2)}\n`, "utf-8");
writeFileSync(join(outDir, "traceability.json"), `${JSON.stringify(compiled.traceability, null, 2)}\n`, "utf-8");
writeFileSync(join(outDir, "evidence-manifest.json"), `${JSON.stringify(compiled.evidenceManifest, null, 2)}\n`, "utf-8");
writeFileSync(join(outDir, "spec-hash.json"), `${JSON.stringify({ specHash: compiled.specHash }, null, 2)}\n`, "utf-8");
console.log(`spec:compile ok ${outDir}`);
