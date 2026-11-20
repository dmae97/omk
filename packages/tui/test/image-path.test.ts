/**
 * Tests for shortenImagePath (home-prefixed path shortening)
 */

import assert from "node:assert";
import { homedir } from "node:os";
import { describe, it } from "node:test";
import { shortenImagePath } from "../src/image-path.ts";

const home = homedir();

describe("shortenImagePath", () => {
	it("shortens paths under home", () => {
		assert.strictEqual(shortenImagePath(`${home}/pics/a.png`), "~/pics/a.png");
	});

	it("shortens Windows-style paths under home", () => {
		assert.strictEqual(shortenImagePath(`${home}\\pics\\a.png`), "~\\pics\\a.png");
	});

	it("shortens home itself to ~", () => {
		assert.strictEqual(shortenImagePath(home), "~");
	});

	it("leaves a sibling path that only shares the prefix unchanged", () => {
		assert.strictEqual(shortenImagePath(`${home}-other/a.png`), `${home}-other/a.png`);
	});

	it("leaves paths outside home unchanged", () => {
		assert.strictEqual(shortenImagePath("/tmp/a.png"), "/tmp/a.png");
	});
});
