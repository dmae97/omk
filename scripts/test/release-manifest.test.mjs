import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	CHECKSUM_FILE,
	RELEASE_MANIFEST_FILE,
	buildReleaseManifest,
	deriveChannel,
	normalizeTag,
	validateManifestShape,
	verifyBundle,
	writeReleaseManifest,
} from "../release-manifest.mjs";

const SOURCE_SHA = "741ac1c4734f66b4d6edb1d25e29198e66f26b20";

function makeBundle() {
	const dir = mkdtempSync(join(tmpdir(), "omk-release-manifest-"));
	writeFileSync(join(dir, "install.sh"), "#!/bin/sh\necho install\n");
	writeFileSync(join(dir, "omk-linux-x64.tar.gz"), "linux archive");
	writeFileSync(join(dir, "omk-darwin-arm64.tar.gz"), "darwin archive");
	writeFileSync(join(dir, "release-notes.md"), "notes");
	return dir;
}

function manifestFor(dir, overrides = {}) {
	return buildReleaseManifest({
		bundleDir: dir,
		tag: "v1.5.5",
		sourceSha: SOURCE_SHA,
		builtAt: "2026-10-22T00:00:00.000Z",
		toolchain: { bun: "1.3.10", node: "24.x", os: "linux" },
		...overrides,
	});
}

describe("release manifest", () => {
	it("normalizes tags and derives channels", () => {
		assert.equal(normalizeTag("1.5.5"), "v1.5.5");
		assert.equal(normalizeTag("v2.0.0-beta.1"), "v2.0.0-beta.1");
		assert.equal(deriveChannel("1.5.5"), "stable");
		assert.equal(deriveChannel("2.0.0-beta.1"), "next");
		assert.throws(() => normalizeTag("v1.5"), /invalid release tag/);
	});

	it("lists payloads, excludes metadata, and writes a checksum file", () => {
		const dir = makeBundle();
		try {
			const manifest = manifestFor(dir);
			assert.deepEqual(
				manifest.files.map((file) => file.name),
				["install.sh", "omk-darwin-arm64.tar.gz", "omk-linux-x64.tar.gz"],
			);
			assert.equal(manifest.files.some((file) => file.name === RELEASE_MANIFEST_FILE), false);
			assert.equal(manifest.files.some((file) => file.name === CHECKSUM_FILE), false);
			assert.equal(manifest.files.some((file) => file.name === "release-notes.md"), false);

			const paths = writeReleaseManifest(dir, manifest);
			const written = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
			assert.deepEqual(written, manifest);
			const checksums = readFileSync(paths.checksumPath, "utf8");
			assert.match(checksums, new RegExp(`  ${RELEASE_MANIFEST_FILE}\\n`));
			assert.match(checksums, /  install\.sh\n/);
			assert.doesNotMatch(checksums, /release-notes\.md/);

			const verification = verifyBundle(dir, written);
			assert.equal(verification.ok, true, verification.errors.join("; "));
			assert.deepEqual(verification.warnings, []);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects a version that does not match the tag", () => {
		const dir = makeBundle();
		try {
			assert.throws(() => manifestFor(dir, { version: "1.5.6" }), /does not match tag/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects an invalid source SHA and channel", () => {
		const dir = makeBundle();
		try {
			assert.throws(() => manifestFor(dir, { sourceSha: "not-a-sha" }), /sourceSha/);
			assert.throws(() => manifestFor(dir, { channel: "preview" }), /channel must be/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("detects manifest tampering and a manifest with no archive", () => {
		const dir = makeBundle();
		try {
			const manifest = manifestFor(dir);
			writeReleaseManifest(dir, manifest);
			writeFileSync(join(dir, RELEASE_MANIFEST_FILE), "{}\n");
			const tampered = verifyBundle(dir, manifest);
			assert.equal(tampered.ok, false);
			assert.ok(tampered.errors.some((error) => error.includes("does not match")));
			const noArchive = { ...manifest, files: manifest.files.filter((file) => file.name === "install.sh") };
			assert.ok(validateManifestShape(noArchive).some((error) => error.includes("platform archive")));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("detects payload tampering and missing files", () => {
		const dir = makeBundle();
		try {
			const manifest = manifestFor(dir);
			writeReleaseManifest(dir, manifest);
			writeFileSync(join(dir, "omk-linux-x64.tar.gz"), "tampered");
			const tampered = verifyBundle(dir, manifest);
			assert.equal(tampered.ok, false);
			assert.ok(tampered.errors.includes("digest mismatch: omk-linux-x64.tar.gz"));
			rmSync(join(dir, "install.sh"));
			const missing = verifyBundle(dir, manifest);
			assert.equal(missing.ok, false);
			assert.ok(missing.errors.includes("missing payload: install.sh"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects reserved and duplicate file entries in the schema", () => {
		const dir = makeBundle();
		try {
			const manifest = manifestFor(dir);
			const reserved = {
				...manifest,
				files: [...manifest.files, { name: RELEASE_MANIFEST_FILE, sha256: "0".repeat(64), bytes: 1 }],
			};
			assert.ok(validateManifestShape(reserved).some((error) => error.includes("reserved")));
			const duplicate = {
				...manifest,
				files: [...manifest.files, { ...manifest.files[0] }],
			};
			assert.ok(validateManifestShape(duplicate).some((error) => error.includes("duplicate")));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
