#!/usr/bin/env node
/**
 * Proof Trust CLI — thin wrapper around ProofTrustMvpEngine.
 *
 * Usage:
 *   node dist/evidence/proof-trust-cli.js <runDir> <bundlePath>
 */

import { readFile } from "node:fs/promises";
import { createProofTrustMvpEngine } from "./proof-trust.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runDir = args[0] ?? ".omk/runs";
  const bundlePath = args[1];

  if (!bundlePath) {
    console.error("Usage: proof-trust-cli <runDir> <bundlePath>");
    process.exit(1);
  }

  const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as unknown;
  const engine = createProofTrustMvpEngine();
  const result = await engine.evaluate(runDir, bundle);

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.missingFields.length > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
