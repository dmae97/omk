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
  return rel === "replay-index.json" ||
    rel === "decisions.jsonl" ||
    rel.startsWith("turns/") ||
    rel === "dag.json" ||
    rel === "dag-compile-report.json" ||
    rel === "summary.json";
}

function isAuditableMemoryArtifact(memoryDir, file) {
  const rel = relative(memoryDir, file).replace(/\\/g, "/");
  if (rel.startsWith("private/")) return false;
  return /(?:^|\/)(graph-state|decisions|project|risks|commands|goals)\.(?:json|jsonl|md|txt)$/.test(rel);
}

async function promptRecordFromFile(runDir, promptFile) {
  const prompt = await readJson(promptFile).catch(() => ({}));
  const promptHash = typeof prompt.promptHash === "string" ? prompt.promptHash : undefined;
  const needles = [
    ...significantNeedles(prompt.userPrompt),
    ...significantNeedles(prompt.compiledPrompt),
  ];
  return { runDir, promptFile, promptHash, needles };
}

async function collectPromptRecords(runDirs) {
  const records = [];
  for (const runDir of runDirs) {
    const promptFiles = (await walk(join(runDir, "private", "prompts"))).filter((file) => file.endsWith(".json"));
    for (const promptFile of promptFiles) {
      const record = await promptRecordFromFile(runDir, promptFile);
      if (record.needles.length > 0) records.push(record);
    }
  }
  return records;
}

function auditTextForLeaks({ file, text, promptRecords, scope }) {
  const leaks = [];
  for (const match of secretLikeMatches(text)) leaks.push({ file, scope, kind: "secret-like", match });
  for (const record of promptRecords) {
    for (const needle of record.needles) {
      if (text.includes(needle)) {
        leaks.push({
          file,
          scope,
          promptFile: record.promptFile,
          kind: "compiled-prompt-leak",
          promptHash: record.promptHash,
          sample: needle.slice(0, 48),
        });
      }
    }
  }
  return leaks;
}

async function auditRun(runDir, allPromptRecords) {
  const promptFiles = (await walk(join(runDir, "private", "prompts"))).filter((file) => file.endsWith(".json"));
  const publicFiles = (await walk(runDir)).filter((file) => isPublicRunArtifact(runDir, file));
  const runPromptRecords = allPromptRecords.filter((record) => record.runDir === runDir);
  const leaks = [];
  let decisionTraceFiles = 0;
  for (const file of publicFiles) {
    if (relative(runDir, file).replace(/\\/g, "/") === "decisions.jsonl") decisionTraceFiles += 1;
    const text = await readFile(file, "utf8").catch(() => "");
    leaks.push(...auditTextForLeaks({ file, text, promptRecords: runPromptRecords, scope: "run-artifact" }));
  }
  return { runDir, promptFiles: promptFiles.length, publicFiles: publicFiles.length, decisionTraceFiles, leaks };
}

async function auditGraphMemory(projectRoot, allPromptRecords) {
  const memoryDir = join(projectRoot, ".omk", "memory");
  const memoryFiles = (await walk(memoryDir)).filter((file) => isAuditableMemoryArtifact(memoryDir, file));
  const leaks = [];
  for (const file of memoryFiles) {
    const text = await readFile(file, "utf8").catch(() => "");
    leaks.push(...auditTextForLeaks({ file, text, promptRecords: allPromptRecords, scope: "graph-memory" }));
  }
  return { memoryFiles: memoryFiles.length, leaks };
}

async function runSelfTest() {
  const dir = await mkdtemp(join(tmpdir(), "omk-prompt-privacy-audit-"));
  try {
    const runDir = join(dir, ".omk", "runs", "self-test");
    await mkdir(join(runDir, "private", "prompts"), { recursive: true });
    await mkdir(join(runDir, "turns"), { recursive: true });
    await mkdir(join(dir, ".omk", "memory"), { recursive: true });
    const prompt = "private customer incident prompt should never appear in public artifacts";
    await writeFile(join(runDir, "private", "prompts", "turn.json"), JSON.stringify({ promptHash: "abc", userPrompt: prompt, compiledPrompt: prompt }), "utf8");
    await writeFile(join(runDir, "turns", "turn-routing.json"), JSON.stringify({ promptHash: "abc" }), "utf8");
    await writeFile(join(runDir, "decisions.jsonl"), JSON.stringify({ outputDecision: "runtime=codex-cli" }) + "\n", "utf8");
    await writeFile(join(dir, ".omk", "memory", "graph-state.json"), JSON.stringify({ nodes: [{ summary: "safe" }] }), "utf8");
    const records = await collectPromptRecords([runDir]);
    const clean = await auditRun(runDir, records);
    const cleanMemory = await auditGraphMemory(dir, records);
    assert.equal(clean.leaks.length + cleanMemory.leaks.length, 0);

    await writeFile(join(runDir, "decisions.jsonl"), JSON.stringify({ leaked: prompt }) + "\n", "utf8");
    const decisionLeaking = await auditRun(runDir, records);
    assert.ok(decisionLeaking.leaks.some((leak) => leak.scope === "run-artifact" && leak.kind === "compiled-prompt-leak"));

    await writeFile(join(dir, ".omk", "memory", "graph-state.json"), JSON.stringify({ leaked: prompt }), "utf8");
    const memoryLeaking = await auditGraphMemory(dir, records);
    assert.ok(memoryLeaking.leaks.some((leak) => leak.scope === "graph-memory" && leak.kind === "compiled-prompt-leak"));

    await writeFile(join(runDir, "turns", "turn-result.jsonl"), JSON.stringify({ leaked: prompt }), "utf8");
    const publicLeaking = await auditRun(runDir, records);
    assert.ok(publicLeaking.leaks.some((leak) => leak.kind === "compiled-prompt-leak"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await runSelfTest();

const runsDir = join(root, ".omk", "runs");
const runDirs = existsSync(runsDir)
  ? (await readdir(runsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => join(runsDir, entry.name))
  : [];
const promptRecords = await collectPromptRecords(runDirs);
const results = [];
for (const runDir of runDirs) {
  const result = await auditRun(runDir, promptRecords);
  if (result.promptFiles > 0 || result.leaks.length > 0 || result.decisionTraceFiles > 0) results.push(result);
}
const graphMemory = await auditGraphMemory(root, promptRecords);
const leaks = [...results.flatMap((result) => result.leaks), ...graphMemory.leaks];
await mkdir(join(root, "proof"), { recursive: true });
await writeFile(proofPath, JSON.stringify({
  schemaVersion: "omk.prompt-privacy-audit.v1",
  checkedAt: new Date().toISOString(),
  runCount: runDirs.length,
  promptEnvelopeCount: promptRecords.length,
  auditedRuns: results.length,
  auditedPublicFiles: results.reduce((sum, result) => sum + result.publicFiles, 0),
  auditedDecisionTraceFiles: results.reduce((sum, result) => sum + result.decisionTraceFiles, 0),
  auditedGraphMemoryFiles: graphMemory.memoryFiles,
  leakCount: leaks.length,
  leaks,
}, null, 2), "utf8");

if (leaks.length > 0) {
  console.error(`prompt privacy audit failed: ${leaks.length} leak(s); artifact=proof/prompt-privacy-audit.json`);
  process.exit(1);
}
console.log(`prompt privacy audit passed; auditedRuns=${results.length}; graphMemoryFiles=${graphMemory.memoryFiles}; artifact=proof/prompt-privacy-audit.json`);
