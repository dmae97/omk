#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { parseDocument } from "yaml";

const ROOTS = [".github"];
const YAML_EXTENSIONS = new Set([".yml", ".yaml"]);

function toPosix(path) {
  return path.replace(/\\/g, "/");
}

function walk(dir) {
  const files = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return files;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && YAML_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(toPosix(fullPath));
    }
  }

  return files;
}

const files = ROOTS.flatMap(walk).sort();
const failures = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const document = parseDocument(text, { prettyErrors: true, strict: true });
  const problems = [...document.errors, ...document.warnings];

  for (const problem of problems) {
    const linePos = problem.linePos?.[0];
    const location = linePos ? `${file}:${linePos.line}:${linePos.col}` : file;
    failures.push(`${location} ${problem.code || "YAML_ERROR"}: ${problem.message}`);
  }
}

if (failures.length > 0) {
  console.error("YAML validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`YAML validation passed: ${files.length} file(s) checked.`);
