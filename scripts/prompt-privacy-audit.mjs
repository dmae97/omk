#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const root = process.cwd();
const proofPath = join(root, "proof", "prompt-privacy-audit.json");

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function significantNeedles(prompt) {
  const normalized = normalizeText(prompt);
  if (normalized.length < 24) return [];
  const needles = new Set();
  needles.add(normalized.slice(0, Math.min(80, normalized.length)));
  for (const sentence of normalized.split(/[.!?\n]/).map((part) => part.trim()).filter(Boolean)) {
    if (sentence.length >= 24) needles.add(sentence.slice(0, 80));
  }
  return [...needles].filter((needle) => needle.length >= 24);
}

function secretLikeMatches(text) {
  const patterns = [
    /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{8,}\b/g,
    /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    /\bghp_[A-Za-z0-9]{36,}\b/g,
    /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
    /\b[A-Za-z_][A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL)[A-Za-z0-9_]*\s*=\s*[^\s"';,]{12,}/g,
  ];
  return patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0].slice(0, 32)));
}

async function walk(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function isPublicRunArtifact(runDir, file) {
  const rel = relative(runDir, file).replace(/\\/g, "/");
  if (rel.startsWith("private/")) return false;
  return rel === "replay-index.json" || rel.startsWith("turns/") || rel === "dag.json" || rel === "dag-compile-report.json" || rel === "summary.json";
}

async function auditRun(runDir) {
  const promptFiles = (await walk(join(runDir, "private", "prompts"))).filter((file) => file.endsWith(".json"));
  const publicFiles = (await walk(runDir)).filter((file) => isPublicRunArtifact(runDir, file));
  const leaks = [];
  const publicTexts = [];
  for (const file of publicFiles) {
    const text = await readFile(file, "utf8").catch(() => "");
    publicTexts.push({ file, text });
    for (const match of secretLikeMatches(text)) leaks.push({ file, kind: "secret-like", match });
  }

  for (const promptFile of promptFiles) {
    const prompt = await readJson(promptFile).catch(() => ({}));
    const promptHash = typeof prompt.promptHash === "string" ? prompt.promptHash : undefined;
    const needles = [
      ...significantNeedles(prompt.userPrompt),
      ...significantNeedles(prompt.compiledPrompt),
    ];
    for (const { file, text } of publicTexts) {
      for (const needle of needles) {
        if (text.includes(needle)) leaks.push({ file, promptFile, kind: "compiled-prompt-leak", promptHash, sample: needle.slice(0, 48) });
      }
    }
  }
  return { runDir, promptFiles: promptFiles.length, publicFiles: publicFiles.length, leaks };
}

async function runSelfTest() {
  const dir = await mkdtemp(join(tmpdir(), "omk-prompt-privacy-audit-"));
  try {
    const runDir = join(dir, ".omk", "runs", "self-test");
    await mkdir(join(runDir, "private", "prompts"), { recursive: true });
    await mkdir(join(runDir, "turns"), { recursive: true });
    const prompt = "private customer incident prompt should never appear in public artifacts";
    await writeFile(join(runDir, "private", "prompts", "turn.json"), JSON.stringify({ promptHash: "abc", userPrompt: prompt, compiledPrompt: prompt }), "utf8");
    await writeFile(join(runDir, "turns", "turn-routing.json"), JSON.stringify({ promptHash: "abc" }), "utf8");
    const clean = await auditRun(runDir);
    assert.equal(clean.leaks.length, 0);
    await writeFile(join(runDir, "turns", "turn-result.jsonl"), JSON.stringify({ leaked: prompt }), "utf8");
    const leaking = await auditRun(runDir);
    assert.ok(leaking.leaks.some((leak) => leak.kind === "compiled-prompt-leak"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await runSelfTest();

const runsDir = join(root, ".omk", "runs");
const runDirs = existsSync(runsDir)
  ? (await readdir(runsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => join(runsDir, entry.name))
  : [];
const results = [];
for (const runDir of runDirs) {
  const result = await auditRun(runDir);
  if (result.promptFiles > 0 || result.leaks.length > 0) results.push(result);
}
const leaks = results.flatMap((result) => result.leaks);
await mkdir(join(root, "proof"), { recursive: true });
await writeFile(proofPath, JSON.stringify({
  schemaVersion: "omk.prompt-privacy-audit.v1",
  checkedAt: new Date().toISOString(),
  runCount: runDirs.length,
  auditedRuns: results.length,
  leakCount: leaks.length,
  leaks,
}, null, 2), "utf8");

if (leaks.length > 0) {
  console.error(`prompt privacy audit failed: ${leaks.length} leak(s); artifact=proof/prompt-privacy-audit.json`);
  process.exit(1);
}
console.log(`prompt privacy audit passed; auditedRuns=${results.length}; artifact=proof/prompt-privacy-audit.json`);
