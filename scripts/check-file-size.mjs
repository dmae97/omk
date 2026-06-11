#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const MAX_LOC = Number.parseInt(process.env.OMK_MAX_NEW_FILE_LOC ?? "1000", 10);
const BASE = process.env.OMK_FILE_SIZE_BASE ?? "HEAD^";
const INCLUDE = /^(src|scripts|test)\//u;
const EXT = /\.(ts|tsx|js|mjs|cjs)$/u;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function revExists(rev) {
  try {
    git(["rev-parse", "--verify", rev]);
    return true;
  } catch {
    return false;
  }
}

if (!revExists(BASE)) {
  console.log(`[file-size] base ${BASE} not available; skipping new-file guard`);
  process.exit(0);
}

const added = git(["diff", "--name-only", "--diff-filter=A", `${BASE}..HEAD`])
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => INCLUDE.test(file) && EXT.test(file) && existsSync(file));

const failures = [];
for (const file of added) {
  const loc = readFileSync(file, "utf8").split(/\r?\n/).length;
  if (loc > MAX_LOC) failures.push({ file, loc });
}

if (failures.length > 0) {
  console.error(`[file-size] ${failures.length} new file(s) exceed ${MAX_LOC} LoC:`);
  for (const failure of failures) console.error(`- ${failure.file}: ${failure.loc}`);
  process.exit(1);
}

console.log(`[file-size] OK - ${added.length} new source/test/script file(s) <= ${MAX_LOC} LoC`);
