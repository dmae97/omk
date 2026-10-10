import assert from "node:assert/strict";
import { test } from "node:test";
import { countAbortSignalAny } from "../check-abort-signal-any.mjs";

test("counts AbortSignal.any() calls and ignores comments", () => {
	const source = [
		"// AbortSignal.any([a, b]) in a line comment",
		"/* AbortSignal.any([a]) in a block comment */",
		"/**",
		" * AbortSignal.any() in a doc comment",
		" */",
		"const one = AbortSignal.any([a, b]);",
		"const two = x ? AbortSignal.any([a]) : AbortSignal.any ( [b] ); // AbortSignal.any()",
	].join("\n");
	assert.equal(countAbortSignalAny(source), 3);
});

test("does not count linkAbortSignals or AbortSignal.timeout", () => {
	assert.equal(countAbortSignalAny("const l = linkAbortSignals(a, AbortSignal.timeout(5));"), 0);
});

test("counts a call that follows a URL string or a glob in a comment", () => {
	const source = [
		'await fetch("https://api.example.com", { signal: AbortSignal.any([a, b]) });',
		"// matches src/**/*.ts",
		"const later = AbortSignal.any([c]);",
		"const quoted = '/* not a comment';",
		"const third = AbortSignal.any([d]);",
	].join("\n");
	assert.equal(countAbortSignalAny(source), 3);
});

test("counts a call on the line after a line comment (the comment keeps its newline)", () => {
	assert.equal(countAbortSignalAny("const n = 0// note\nAbortSignal.any([a, b]);"), 1);
	assert.equal(countAbortSignalAny("x = 1// note\r\nAbortSignal.any([a]);"), 1);
});
