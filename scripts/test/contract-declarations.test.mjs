import test from "node:test";
import assert from "node:assert/strict";
import { readRustBundle } from "../contracts/artifacts.mjs";
import { generateArtifacts } from "../contracts/typescript.mjs";
import { checkDeclarationTypes } from "../contracts/typecheck.mjs";

test("generated types accept recorded sessions/RPC and reject invalid command, UI and host shapes", () => {
	const result = checkDeclarationTypes(generateArtifacts(readRustBundle()));
	assert.equal(result.status, 0, result.output);
	// 97 since the G0 fixture lost four empty skill_admission_turn records (#418).
	assert.ok(result.positiveSamples >= 97);
	assert.ok(result.negativeSamples >= 10);
});
