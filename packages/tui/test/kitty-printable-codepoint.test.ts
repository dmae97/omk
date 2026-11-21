/**
 * Tests for parseUnmodifiedKittyPrintableCodepoint (Kitty keyboard protocol,
 * unmodified printable key sequences)
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseUnmodifiedKittyPrintableCodepoint } from "../src/kitty-printable-codepoint.ts";

describe("parseUnmodifiedKittyPrintableCodepoint", () => {
	it("returns the codepoint for a bare sequence", () => {
		assert.strictEqual(parseUnmodifiedKittyPrintableCodepoint("\x1b[97u"), 97);
	});

	it("returns the codepoint with one modifier sub-parameter", () => {
		assert.strictEqual(parseUnmodifiedKittyPrintableCodepoint("\x1b[97:65u"), 97);
	});

	it("returns the codepoint with an empty first sub-parameter", () => {
		assert.strictEqual(parseUnmodifiedKittyPrintableCodepoint("\x1b[97::98u"), 97);
	});

	it("returns the codepoint with two sub-parameters", () => {
		assert.strictEqual(parseUnmodifiedKittyPrintableCodepoint("\x1b[97:65:98u"), 97);
	});

	it("returns the space codepoint at the lower boundary", () => {
		assert.strictEqual(parseUnmodifiedKittyPrintableCodepoint("\x1b[32u"), 32);
	});

	it("returns undefined for codepoints below the printable range", () => {
		assert.strictEqual(parseUnmodifiedKittyPrintableCodepoint("\x1b[13u"), undefined);
		assert.strictEqual(parseUnmodifiedKittyPrintableCodepoint("\x1b[31u"), undefined);
	});

	it("returns undefined for a sequence with a semicolon separator", () => {
		assert.strictEqual(parseUnmodifiedKittyPrintableCodepoint("\x1b[97;5u"), undefined);
	});

	it("returns undefined for plain text", () => {
		assert.strictEqual(parseUnmodifiedKittyPrintableCodepoint("a"), undefined);
	});
});
