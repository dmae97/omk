import test from "node:test";
import assert from "node:assert/strict";
import { readRustBundle } from "../contracts/artifacts.mjs";
import { generateArtifacts } from "../contracts/typescript.mjs";
import { checkDeclarationTypes } from "../contracts/typecheck.mjs";

test("generated types accept recorded sessions/RPC and reject invalid command, UI and host shapes", () => {
	const result = checkDeclarationTypes(generateArtifacts(readRustBundle()));
	assert.equal(result.status, 0, result.output);
	assert.ok(result.positiveSamples >= 101);
	assert.ok(result.negativeSamples >= 10);
});
