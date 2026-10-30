import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packages = ["ai", "tui", "agent", "protocol", "adaptorch-wpl", "coding-agent", "book-to-skill"];

describe("release surface license checks", () => {
	let fixture;
	let rootLicense;

	before(() => {
		fixture = mkdtempSync(join(tmpdir(), "omk-license-pack-"));
		rootLicense = readFileSync(join(root, "LICENSE"));
		mkdirSync(join(fixture, "scripts"));
		copyFileSync(join(root, "scripts/check-release-surface.mjs"), join(fixture, "scripts/check-release-surface.mjs"));
		writeFileSync(join(fixture, "LICENSE"), rootLicense);
		for (const name of packages) {
			const dir = join(fixture, "packages", name);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "package.json"),
				JSON.stringify({
					name: `fixture-${name}`,
					version: "1.0.0",
					files: ["LICENSE", "DEVIN-NOTICE", "resources", "vendor"],
				}),
			);
			writeFileSync(join(dir, "LICENSE"), name === "book-to-skill" ? "Book license\n" : rootLicense);
		}
		writeFileSync(join(fixture, "packages/ai/DEVIN-NOTICE"), "Devin notice\n");
		mkdirSync(join(fixture, "packages/coding-agent/resources/pstack"), { recursive: true });
		writeFileSync(join(fixture, "packages/coding-agent/resources/pstack/LICENSE"), "pstack license\n");
		mkdirSync(join(fixture, "packages/book-to-skill/vendor/book-to-skill"), { recursive: true });
		writeFileSync(join(fixture, "packages/book-to-skill/vendor/book-to-skill/LICENSE.md"), "upstream license\n");
	});

	after(() => rmSync(fixture, { recursive: true, force: true }));

	function check() {
		return spawnSync(process.execPath, [join(fixture, "scripts/check-release-surface.mjs")], {
			encoding: "utf8",
		});
	}

	it("accepts packages with the required license and third-party notices", () => {
		const result = check();
		assert.equal(result.status, 0, result.stderr);
	});

	it("rejects a missing package-root LICENSE", () => {
		const path = join(fixture, "packages/ai/LICENSE");
		unlinkSync(path);
		try {
			const result = check();
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /packages\/ai: missing license or notice: LICENSE/);
		} finally {
			writeFileSync(path, rootLicense);
		}
	});

	it("rejects a license that has drifted from the root copy", () => {
		const path = join(fixture, "packages/tui/LICENSE");
		writeFileSync(path, "incomplete license\n");
		try {
			const result = check();
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /packages\/tui: LICENSE differs from the root LICENSE/);
		} finally {
			writeFileSync(path, rootLicense);
		}
	});

	it("rejects a missing third-party notice", () => {
		const path = join(fixture, "packages/ai/DEVIN-NOTICE");
		unlinkSync(path);
		try {
			const result = check();
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /packages\/ai: missing license or notice: DEVIN-NOTICE/);
		} finally {
			writeFileSync(path, "Devin notice\n");
		}
	});
});
