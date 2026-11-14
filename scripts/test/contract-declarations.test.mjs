import test from "node:test";
import assert from "node:assert/strict";
import { readRustBundle } from "../contracts/artifacts.mjs";
import { generateArtifacts } from "../contracts/typescript.mjs";
import { checkDeclarationTypes } from "../contracts/typecheck.mjs";

test("generated types accept recorded sessions/RPC and reject invalid command, UI and host shapes", () => {
	const result = checkDeclarationTypes(generateArtifacts(readRustBundle()));
	assert.equal(result.status, 0, result.output);
	// I1: 20 session rows + 35 RPC rows + 29 commands + 14 explicit boundary shapes,
	// including a legacy marker even though new sessions no longer emit empty ones.
	assert.equal(result.positiveSamples, 98);
	assert.ok(result.negativeSamples >= 10);
});
