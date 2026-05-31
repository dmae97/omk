#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

const root = process.cwd();
const proofRoot = "proof/verified-runs";
const expectedSchemaVersion = "omk.proof-bundle.v1";
const requiredFileKeys = ["rawPrompt", "commands", "verifyJson", "decisionsJsonl", "runManifest", "evidenceJsonl", "limitations"];
const allowedScenarios = new Set(["no-kimi-smoke", "evidence-block", "fallback-route", "dag-dependent-block", "replay-inspect", "example-generation", "doctor-provider", "native-safety", "contract-version-smoke"]);
const allowedVerdicts = new Set(["passed", "failed", "partial"]);
const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const explicitTargets = args.filter((arg) => arg !== "--json");
const placeholderPattern = /\b(TODO|FIXME|TBD|PLACEHOLDER|CHANGEME|REPLACE_ME)\b|<capture>|capture pending/i;
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
  if (placeholderPattern.test(text)) errors.push(`${label}: TODO/capture placeholder found`);
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
    if (typeof bundle[field] !== "string" || bundle[field].length === 0) errors.push(`${label}: ${field} must be a non-empty string`);
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

async function validateJsonArtifact(errors, label, artifactPath, expectedVersion) {
  try {
    const parsed = await readJson(artifactPath);
    if (!isObject(parsed)) errors.push(`${label}: JSON artifact must be an object`);
    if (parsed.schemaVersion !== expectedVersion) errors.push(`${label}: schemaVersion must be ${expectedVersion}`);
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateJsonlArtifact(errors, label, artifactPath, expectedVersion) {
  const text = await readFile(artifactPath, "utf8");
  scanText(errors, label, text);
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) errors.push(`${label}: JSONL artifact is empty`);
  for (const [index, line] of lines.entries()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.schemaVersion !== expectedVersion) errors.push(`${label}:${index + 1}: schemaVersion must be ${expectedVersion}`);
    } catch (error) {
      errors.push(`${label}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  const limitationsPath = resolveRepoPath(bundle.files.limitations);
  if (limitationsPath && (await readFile(limitationsPath, "utf8")).trim().length === 0) errors.push(`${bundle.files.limitations}: limitations file is empty`);
  const verifyPath = resolveRepoPath(bundle.files.verifyJson);
  if (verifyPath) await validateJsonArtifact(errors, bundle.files.verifyJson, verifyPath, "omk.contract.v1");
  const manifestPath = resolveRepoPath(bundle.files.runManifest);
  if (manifestPath) await validateJsonArtifact(errors, bundle.files.runManifest, manifestPath, "omk.run-manifest.v1");
  const evidencePath = resolveRepoPath(bundle.files.evidenceJsonl);
  if (evidencePath) await validateJsonlArtifact(errors, bundle.files.evidenceJsonl, evidencePath, "omk.evidence.v1");
  const decisionPath = resolveRepoPath(bundle.files.decisionsJsonl);
  if (decisionPath) await validateJsonlArtifact(errors, bundle.files.decisionsJsonl, decisionPath, "omk.decision.v1");
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
