#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

const root = process.cwd();
const proofRoot = "proof/verified-runs";
const expectedSchemaVersion = "omk.proof-bundle.v1";
const requiredFileKeys = ["rawPrompt", "commands", "verifyJson", "decisionsJsonl", "runManifest", "evidenceJsonl", "limitations", "sha256sums"];
const allowedScenarios = new Set(["no-kimi-smoke", "evidence-block", "fallback-route", "dag-dependent-block", "replay-inspect", "graph-audit", "example-generation", "doctor-provider", "native-safety", "contract-version-smoke"]);
const allowedVerdicts = new Set(["passed", "failed", "partial"]);
const allowedEvidenceKinds = new Set(["file-exists", "command-passes", "git-diff-non-empty", "summary-present", "marker-present", "screenshot-present", "custom"]);
const allowedEvidenceStatuses = new Set(["passed", "failed", "missing", "skipped", "blocked"]);
const allowedDecisionKinds = new Set(["provider-selection", "fallback-routing", "retry-policy", "skip-policy", "dependent-block", "context-brokering", "skill-assignment", "evidence-verdict", "security-policy"]);
const allowedDecisionActors = new Set(["runtime-router", "scheduler", "evidence-gate", "provider-router", "operator"]);
const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const explicitTargets = args.filter((arg) => arg !== "--json");
const placeholderPattern = /\b(TODO|FIXME|TBD|PLACEHOLDER|CHANGEME|REPLACE_ME|FABRICATED)\b|<capture>|capture pending/i;
const localPathPattern = /(^|[\s"'`=:(])(?:\/home\/|\/Users\/|[A-Za-z]:\\)/;
const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /glpat-[A-Za-z0-9_-]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"']{12,}/i,
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isRepoRelative(path) {
  return typeof path === "string" && path.length > 0 && !isAbsolute(path) && !path.split(/[\\/]+/).includes("..") && path === path.replaceAll("\\", "/");
}

function resolveRepoPath(path) {
  if (!isRepoRelative(path)) return undefined;
  const absolute = join(root, path);
  const back = relative(root, absolute);
  if (back.startsWith("..") || isAbsolute(back)) return undefined;
  return absolute;
}

function scanText(errors, label, text) {
  if (placeholderPattern.test(text)) errors.push(`${label}: TODO/placeholder/fabricated marker found`);
  if (localPathPattern.test(text)) errors.push(`${label}: local absolute path found`);
  for (const pattern of secretPatterns) if (pattern.test(text)) errors.push(`${label}: secret-like pattern found`);
}

function scanUnknown(errors, label, value) {
  if (typeof value === "string") scanText(errors, label, value);
  if (Array.isArray(value)) value.forEach((item, index) => scanUnknown(errors, `${label}[${index}]`, item));
  if (isObject(value)) for (const [key, item] of Object.entries(value)) scanUnknown(errors, `${label}.${key}`, item);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function listFilesRecursive(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFilesRecursive(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function findBundles() {
  if (explicitTargets.length > 0) return explicitTargets;
  if (!existsSync(join(root, proofRoot))) return [];
  const entries = await readdir(join(root, proofRoot), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => `${proofRoot}/${entry.name}/proof-bundle.json`).filter((path) => existsSync(join(root, path)));
}

function validateBundleShape(errors, bundle, label) {
  if (!isObject(bundle)) return errors.push(`${label}: proof-bundle.json must be an object`);
  if (bundle.schemaVersion !== expectedSchemaVersion) errors.push(`${label}: schemaVersion must be ${expectedSchemaVersion}`);
  for (const field of ["proofId", "title", "omkVersion", "runtimeVersion", "commit", "runId", "providerPolicy", "scenario", "verdict"]) {
    if (!isNonEmptyString(bundle[field])) errors.push(`${label}: ${field} must be a non-empty string`);
  }
  if (!allowedScenarios.has(bundle.scenario)) errors.push(`${label}: unsupported scenario ${String(bundle.scenario)}`);
  if (!allowedVerdicts.has(bundle.verdict)) errors.push(`${label}: unsupported verdict ${String(bundle.verdict)}`);
  if (!Array.isArray(bundle.knownLimitations) || bundle.knownLimitations.length === 0) errors.push(`${label}: knownLimitations must be non-empty`);
  if (!isObject(bundle.files)) errors.push(`${label}: files must be an object`);
  if (!isObject(bundle.checksums)) errors.push(`${label}: checksums must be an object`);
  for (const key of requiredFileKeys) {
    const path = bundle.files?.[key];
    if (!isRepoRelative(path)) errors.push(`${label}: files.${key} must be repo-relative`);
  }
}

function validateEnvelope(errors, label, parsed) {
  if (!isObject(parsed)) return errors.push(`${label}: JSON artifact must be an object`);
  if (parsed.schemaVersion !== "omk.contract.v1") errors.push(`${label}: schemaVersion must be omk.contract.v1`);
  for (const field of ["command", "omkVersion", "runtimeVersion", "traceId", "status"]) {
    if (!isNonEmptyString(parsed[field])) errors.push(`${label}: ${field} must be a non-empty string`);
  }
  if (typeof parsed.ok !== "boolean") errors.push(`${label}: ok must be boolean`);
  if (!isObject(parsed.metadata)) errors.push(`${label}: metadata must be an object`);
  if (parsed.metadata?.cwd !== "[repo-root]") errors.push(`${label}: metadata.cwd must be [repo-root]`);
  if (!Array.isArray(parsed.warnings)) errors.push(`${label}: warnings must be an array`);
  if (!Array.isArray(parsed.errors)) errors.push(`${label}: errors must be an array`);
}

function validateRunManifest(errors, label, parsed) {
  if (!isObject(parsed)) return errors.push(`${label}: run manifest must be an object`);
  if (parsed.schemaVersion !== "omk.run-manifest.v1") errors.push(`${label}: schemaVersion must be omk.run-manifest.v1`);
  if (!isNonEmptyString(parsed.runId)) errors.push(`${label}: runId must be a non-empty string`);
  if (parsed.decisionTracePath !== undefined && !isRepoRelative(parsed.decisionTracePath)) errors.push(`${label}: decisionTracePath must be repo-relative when present`);
  if (parsed.evidenceSummary !== undefined && !isObject(parsed.evidenceSummary)) errors.push(`${label}: evidenceSummary must be an object when present`);
}

function validateEvidenceRecord(errors, label, record) {
  if (!isObject(record)) return errors.push(`${label}: evidence record must be an object`);
  if (record.schemaVersion !== "omk.evidence.v1") errors.push(`${label}: schemaVersion must be omk.evidence.v1`);
  for (const field of ["runId", "evidenceId", "kind", "status", "observedAt"]) {
    if (!isNonEmptyString(record[field])) errors.push(`${label}: ${field} must be a non-empty string`);
  }
  if (!allowedEvidenceKinds.has(record.kind)) errors.push(`${label}: unsupported evidence kind ${String(record.kind)}`);
  if (!allowedEvidenceStatuses.has(record.status)) errors.push(`${label}: unsupported evidence status ${String(record.status)}`);
  if (typeof record.required !== "boolean") errors.push(`${label}: required must be boolean`);
  if (record.path !== undefined && !isRepoRelative(record.path)) errors.push(`${label}: path must be repo-relative when present`);
  if (record.exitCode !== undefined && typeof record.exitCode !== "number") errors.push(`${label}: exitCode must be number when present`);
}

function validateDecisionRecord(errors, label, record) {
  if (!isObject(record)) return errors.push(`${label}: decision record must be an object`);
  if (record.schemaVersion !== "omk.decision.v1") errors.push(`${label}: schemaVersion must be omk.decision.v1`);
  for (const field of ["runId", "decisionId", "timestamp", "kind", "actor", "reason"]) {
    if (!isNonEmptyString(record[field])) errors.push(`${label}: ${field} must be a non-empty string`);
  }
  if (!allowedDecisionKinds.has(record.kind)) errors.push(`${label}: unsupported decision kind ${String(record.kind)}`);
  if (!allowedDecisionActors.has(record.actor)) errors.push(`${label}: unsupported decision actor ${String(record.actor)}`);
  if (!Array.isArray(record.inputRefs)) errors.push(`${label}: inputRefs must be an array`);
  if (!Array.isArray(record.outputRefs)) errors.push(`${label}: outputRefs must be an array`);
  if (record.confidence !== undefined && (typeof record.confidence !== "number" || record.confidence < 0 || record.confidence > 1)) errors.push(`${label}: confidence must be between 0 and 1 when present`);
  if (record.evidenceRefs !== undefined && !Array.isArray(record.evidenceRefs)) errors.push(`${label}: evidenceRefs must be an array when present`);
}

async function validateJsonArtifact(errors, label, artifactPath, kind) {
  try {
    const parsed = await readJson(artifactPath);
    scanUnknown(errors, label, parsed);
    if (kind === "envelope") validateEnvelope(errors, label, parsed);
    else if (kind === "run-manifest") validateRunManifest(errors, label, parsed);
    else errors.push(`${label}: unsupported JSON artifact kind ${kind}`);
    return parsed;
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function validateJsonlArtifact(errors, label, artifactPath, kind) {
  const records = [];
  try {
    const text = await readFile(artifactPath, "utf8");
    scanText(errors, label, text);
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) errors.push(`${label}: JSONL artifact is empty`);
    for (const [index, line] of lines.entries()) {
      try {
        const parsed = JSON.parse(line);
        scanUnknown(errors, `${label}:${index + 1}`, parsed);
        if (kind === "evidence") validateEvidenceRecord(errors, `${label}:${index + 1}`, parsed);
        else if (kind === "decision") validateDecisionRecord(errors, `${label}:${index + 1}`, parsed);
        else errors.push(`${label}:${index + 1}: unsupported JSONL artifact kind ${kind}`);
        records.push(parsed);
      } catch (error) {
        errors.push(`${label}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return records;
}

function collectRefs(refs, pathKey, idKey) {
  const result = { coversAll: false, ids: new Set() };
  if (!Array.isArray(refs)) return result;
  for (const ref of refs) {
    if (typeof ref === "string") {
      if (ref === pathKey) result.coversAll = true;
      else result.ids.add(ref);
    } else if (isObject(ref)) {
      if (ref.path === pathKey) result.coversAll = true;
      if (typeof ref[idKey] === "string") result.ids.add(ref[idKey]);
    }
  }
  return result;
}

async function validateSha256Sums(errors, bundlePath, bundle, referencedPaths) {
  const sumsPath = bundle.files.sha256sums;
  if (!isRepoRelative(sumsPath)) return errors.push(`${bundlePath}: files.sha256sums must be repo-relative`);
  const absoluteSumsPath = resolveRepoPath(sumsPath);
  if (!absoluteSumsPath || !existsSync(absoluteSumsPath)) return errors.push(`${sumsPath}: missing sha256 sums artifact`);

  const expectedPaths = new Set([...referencedPaths].filter((path) => path !== sumsPath));
  const seen = new Set();
  const text = await readFile(absoluteSumsPath, "utf8");
  scanText(errors, sumsPath, text);
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) errors.push(`${sumsPath}: sha256sums.txt is empty`);

  for (const [index, line] of lines.entries()) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) {
      errors.push(`${sumsPath}:${index + 1}: expected '<sha256>  <repo-relative-path>'`);
      continue;
    }
    const [, expectedHash, artifactPath] = match;
    if (!isRepoRelative(artifactPath)) {
      errors.push(`${sumsPath}:${index + 1}: artifact path must be repo-relative`);
      continue;
    }
    if (!expectedPaths.has(artifactPath)) errors.push(`${sumsPath}:${index + 1}: unexpected artifact path ${artifactPath}`);
    if (seen.has(artifactPath)) errors.push(`${sumsPath}:${index + 1}: duplicate artifact path ${artifactPath}`);
    seen.add(artifactPath);

    const absoluteArtifactPath = resolveRepoPath(artifactPath);
    if (!absoluteArtifactPath || !existsSync(absoluteArtifactPath)) {
      errors.push(`${sumsPath}:${index + 1}: missing artifact ${artifactPath}`);
      continue;
    }
    const actualHash = await digest(absoluteArtifactPath);
    if (expectedHash !== actualHash) errors.push(`${sumsPath}:${index + 1}: hash mismatch for ${artifactPath}`);
    if (bundle.checksums[artifactPath] !== expectedHash) errors.push(`${sumsPath}:${index + 1}: hash must match proof-bundle checksums for ${artifactPath}`);
  }

  for (const expectedPath of expectedPaths) {
    if (!seen.has(expectedPath)) errors.push(`${sumsPath}: missing checksum entry for ${expectedPath}`);
  }
}

function enforceLinkage(errors, bundlePath, bundle, verify, manifest, evidenceRecords, decisionRecords) {
  if (verify?.runId !== undefined && verify.runId !== bundle.runId) errors.push(`${bundlePath}: verify.runId must match bundle.runId`);
  if (verify?.commit !== undefined && verify.commit !== bundle.commit) errors.push(`${bundlePath}: verify.commit must match bundle.commit`);
  if (verify?.omkVersion !== undefined && verify.omkVersion !== bundle.omkVersion) errors.push(`${bundlePath}: verify.omkVersion must match bundle.omkVersion`);
  if (verify?.runtimeVersion !== undefined && verify.runtimeVersion !== bundle.runtimeVersion) errors.push(`${bundlePath}: verify.runtimeVersion must match bundle.runtimeVersion`);
  if (manifest?.runId !== undefined && manifest.runId !== bundle.runId) errors.push(`${bundlePath}: run-manifest.runId must match bundle.runId`);
  if (manifest?.decisionTracePath !== undefined && manifest.decisionTracePath !== bundle.files.decisionsJsonl) errors.push(`${bundlePath}: run-manifest.decisionTracePath must match files.decisionsJsonl`);

  for (const record of evidenceRecords) if (record.runId !== bundle.runId) errors.push(`${bundle.files.evidenceJsonl}: evidence ${String(record.evidenceId)} runId must match bundle.runId`);
  for (const record of decisionRecords) if (record.runId !== bundle.runId) errors.push(`${bundle.files.decisionsJsonl}: decision ${String(record.decisionId)} runId must match bundle.runId`);

  const evidenceRefs = collectRefs(verify?.evidenceRefs, bundle.files.evidenceJsonl, "evidenceId");
  for (const record of evidenceRecords) {
    if (!evidenceRefs.coversAll && !evidenceRefs.ids.has(record.evidenceId)) errors.push(`${bundlePath}: verify.evidenceRefs must reference evidenceId ${String(record.evidenceId)} or ${bundle.files.evidenceJsonl}`);
  }
  const decisionRefs = collectRefs(verify?.decisionRefs, bundle.files.decisionsJsonl, "decisionId");
  for (const record of decisionRecords) {
    if (!decisionRefs.coversAll && !decisionRefs.ids.has(record.decisionId)) errors.push(`${bundlePath}: verify.decisionRefs must reference decisionId ${String(record.decisionId)} or ${bundle.files.decisionsJsonl}`);
  }

  const evidenceIds = new Set(evidenceRecords.map((record) => record.evidenceId).filter(Boolean));
  for (const decision of decisionRecords) {
    if (Array.isArray(decision.evidenceRefs)) {
      for (const ref of decision.evidenceRefs) if (typeof ref === "string" && !evidenceIds.has(ref)) errors.push(`${bundlePath}: decision ${decision.decisionId} evidenceRef ${ref} has no matching evidence record`);
    }
  }

  if (bundle.proofId === "010-fallback-routing") {
    const fallback = decisionRecords.find((record) => record.kind === "fallback-routing");
    if (!fallback) errors.push(`${bundlePath}: 010-fallback-routing requires a fallback-routing decision`);
    else {
      if (!isNonEmptyString(fallback.providerBefore)) errors.push(`${bundlePath}: fallback-routing decision requires providerBefore`);
      if (!isNonEmptyString(fallback.providerAfter)) errors.push(`${bundlePath}: fallback-routing decision requires providerAfter`);
      if (!Array.isArray(fallback.evidenceRefs) || fallback.evidenceRefs.length === 0) errors.push(`${bundlePath}: fallback-routing decision requires evidenceRefs`);
    }
  }

  if (bundle.proofId === "009-no-kimi-smoke") {
    const text = `${bundle.providerPolicy}\n${verify?.data ? JSON.stringify(verify.data) : ""}`;
    if (!/no-kimi|kimiUnavailable|KIMI_API_KEY is not set|not configured/i.test(text)) errors.push(`${bundlePath}: no-Kimi proof must explicitly record the direct-API Kimi-unavailable/nonfatal policy`);
  }
}

async function checkBundle(bundlePath) {
  const errors = [];
  if (!isRepoRelative(bundlePath)) errors.push(`${bundlePath}: bundle path must be repo-relative`);
  const absoluteBundlePath = resolveRepoPath(bundlePath);
  if (!absoluteBundlePath || !existsSync(absoluteBundlePath)) return { bundlePath, proofId: bundlePath, ok: false, errors: [`${bundlePath}: missing bundle`] };
  const bundleText = await readFile(absoluteBundlePath, "utf8");
  scanText(errors, bundlePath, bundleText);
  let bundle;
  try {
    bundle = JSON.parse(bundleText);
  } catch (error) {
    return { bundlePath, proofId: bundlePath, ok: false, errors: [`${bundlePath}: ${error instanceof Error ? error.message : String(error)}`] };
  }
  scanUnknown(errors, bundlePath, bundle);
  validateBundleShape(errors, bundle, bundlePath);
  if (!isObject(bundle.files) || !isObject(bundle.checksums)) return { bundlePath, proofId: bundle.proofId ?? bundlePath, ok: errors.length === 0, errors };

  const referencedPaths = new Set(Object.values(bundle.files).filter((value) => typeof value === "string"));
  const bundleDirectory = dirname(absoluteBundlePath);
  const bundleFiles = await listFilesRecursive(bundleDirectory);
  for (const absoluteArtifactPath of bundleFiles) {
    const repoPath = relative(root, absoluteArtifactPath).replaceAll("\\", "/");
    const content = await readFile(absoluteArtifactPath, "utf8");
    scanText(errors, repoPath, content);
    if (repoPath !== bundlePath && !referencedPaths.has(repoPath)) errors.push(`${repoPath}: proof directory file must be referenced by proof-bundle.json files`);
  }
  for (const artifactPath of referencedPaths) {
    if (!isRepoRelative(artifactPath)) {
      errors.push(`${bundlePath}: artifact path must be repo-relative: ${artifactPath}`);
      continue;
    }
    const absoluteArtifactPath = resolveRepoPath(artifactPath);
    if (!absoluteArtifactPath || !existsSync(absoluteArtifactPath)) {
      errors.push(`${artifactPath}: missing artifact`);
      continue;
    }
    await stat(absoluteArtifactPath);
    const content = await readFile(absoluteArtifactPath, "utf8");
    scanText(errors, artifactPath, content);
    const actual = await digest(absoluteArtifactPath);
    if (bundle.checksums[artifactPath] !== actual) errors.push(`${artifactPath}: checksum mismatch`);
  }
  for (const checksumPath of Object.keys(bundle.checksums)) {
    if (!referencedPaths.has(checksumPath)) errors.push(`${bundlePath}: checksum has no matching files entry: ${checksumPath}`);
  }
  await validateSha256Sums(errors, bundlePath, bundle, referencedPaths);
  const limitationsPath = resolveRepoPath(bundle.files.limitations);
  if (limitationsPath && (await readFile(limitationsPath, "utf8")).trim().length === 0) errors.push(`${bundle.files.limitations}: limitations file is empty`);

  const verifyPath = resolveRepoPath(bundle.files.verifyJson);
  const verify = verifyPath ? await validateJsonArtifact(errors, bundle.files.verifyJson, verifyPath, "envelope") : undefined;
  const manifestPath = resolveRepoPath(bundle.files.runManifest);
  const manifest = manifestPath ? await validateJsonArtifact(errors, bundle.files.runManifest, manifestPath, "run-manifest") : undefined;
  const evidencePath = resolveRepoPath(bundle.files.evidenceJsonl);
  const evidenceRecords = evidencePath ? await validateJsonlArtifact(errors, bundle.files.evidenceJsonl, evidencePath, "evidence") : [];
  const decisionPath = resolveRepoPath(bundle.files.decisionsJsonl);
  const decisionRecords = decisionPath ? await validateJsonlArtifact(errors, bundle.files.decisionsJsonl, decisionPath, "decision") : [];
  enforceLinkage(errors, bundlePath, bundle, verify, manifest, evidenceRecords, decisionRecords);
  return { bundlePath, proofId: bundle.proofId ?? bundlePath, ok: errors.length === 0, errors };
}

const schemaPath = "schemas/omk.proof-bundle.v1.schema.json";
const schemaErrors = [];
try {
  const schema = await readJson(join(root, schemaPath));
  if (schema.properties?.schemaVersion?.const !== expectedSchemaVersion) schemaErrors.push(`${schemaPath}: schemaVersion const mismatch`);
} catch (error) {
  schemaErrors.push(`${schemaPath}: ${error instanceof Error ? error.message : String(error)}`);
}
const results = [];
for (const bundlePath of await findBundles()) results.push(await checkBundle(bundlePath));
if (results.length === 0) results.push({ bundlePath: proofRoot, proofId: proofRoot, ok: false, errors: ["no proof bundles found"] });
if (schemaErrors.length > 0) results.unshift({ bundlePath: schemaPath, proofId: schemaPath, ok: false, errors: schemaErrors });
const ok = results.every((result) => result.ok);
if (jsonMode) console.log(JSON.stringify({ ok, checkedBundles: results.length, schemaVersion: expectedSchemaVersion, results }, null, 2));
else for (const result of results) {
  console.log(`${result.ok ? "passed" : "failed"}: ${result.proofId} (${result.bundlePath})`);
  for (const error of result.errors) console.error(`  - ${error}`);
}
if (!ok) process.exit(1);
