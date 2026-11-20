/**
 * Tests for rawCtrlChar (legacy control character mapping)
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { rawCtrlChar } from "../src/key-character.ts";

describe("rawCtrlChar", () => {
	it("maps lowercase letters to control codes", () => {
		assert.strictEqual(rawCtrlChar("a"), "\x01");
		assert.strictEqual(rawCtrlChar("z"), "\x1a");
	});

	it("folds uppercase before mapping", () => {
		assert.strictEqual(rawCtrlChar("A"), "\x01");
		assert.strictEqual(rawCtrlChar("C"), "\x03");
		assert.strictEqual(rawCtrlChar("Z"), "\x1a");
	});

	it("maps bracket and backslash keys", () => {
		assert.strictEqual(rawCtrlChar("["), "\x1b");
		assert.strictEqual(rawCtrlChar("\\"), "\x1c");
		assert.strictEqual(rawCtrlChar("]"), "\x1d");
	});

	it("maps '_' and the '-' alias to the same code", () => {
		assert.strictEqual(rawCtrlChar("_"), "\x1f");
		assert.strictEqual(rawCtrlChar("-"), "\x1f");
	});

	it("returns null for non-mapped keys", () => {
		assert.strictEqual(rawCtrlChar("1"), null);
		assert.strictEqual(rawCtrlChar(" "), null);
		assert.strictEqual(rawCtrlChar("é"), null);
	});
});
