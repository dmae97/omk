import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	buildCreateArgs,
	buildUploadArgs,
	normalizeRemoteAssets,
	parseArgs,
} from "../reconcile-release.mjs";
import {
	classifyReleaseAssets,
	localAssetsFromManifest,
	planReleaseReconciliation,
	RELEASE_ASSET_STATE,
} from "../release-asset-state.mjs";
import { buildReleaseManifest, writeReleaseManifest } from "../release-manifest.mjs";

const SOURCE_SHA = "741ac1c4734f66b4d6edb1d25e29198e66f26b20";

function localAssets() {
	return [
		{ name: "install.sh", sha256: "a".repeat(64), bytes: 10 },
		{ name: "omk-linux-x64.tar.gz", sha256: "b".repeat(64), bytes: 20 },
		{ name: "release-manifest.json", sha256: "c".repeat(64), bytes: 30 },
		{ name: "SHA256SUMS", sha256: "d".repeat(64), bytes: 40 },
	];
}

describe("release asset state machine", () => {
	it("treats a missing release as absent and plans create", () => {
		const state = classifyReleaseAssets({ releaseExists: false, localAssets: localAssets(), remoteAssets: [] });
		assert.equal(state.state, RELEASE_ASSET_STATE.ABSENT);
		const plan = planReleaseReconciliation(state);
		assert.equal(plan.action, "create");
		assert.deepEqual(plan.uploadNames, localAssets().map((asset) => asset.name));
	});

	it("plans only missing assets for a partial release", () => {
		const locals = localAssets();
		const state = classifyReleaseAssets({
			releaseExists: true,
			localAssets: locals,
			remoteAssets: [locals[0], locals[3]],
		});
		assert.equal(state.state, RELEASE_ASSET_STATE.PARTIAL);
		const plan = planReleaseReconciliation(state);
		assert.equal(plan.action, "upload");
		assert.deepEqual(plan.uploadNames, ["omk-linux-x64.tar.gz", "release-manifest.json"]);
	});

	it("is a no-op when every asset matches", () => {
		const locals = localAssets();
		const state = classifyReleaseAssets({ releaseExists: true, localAssets: locals, remoteAssets: locals });
		assert.equal(state.state, RELEASE_ASSET_STATE.COMPLETE);
		const plan = planReleaseReconciliation(state);
		assert.equal(plan.action, "none");
		assert.deepEqual(plan.uploadNames, []);
	});

	it("stops on a same-name digest conflict without uploading", () => {
		const locals = localAssets();
		const state = classifyReleaseAssets({
			releaseExists: true,
			localAssets: locals,
			remoteAssets: [{ ...locals[1], sha256: "f".repeat(64) }, ...locals.filter((asset) => asset !== locals[1])],
		});
		assert.equal(state.state, RELEASE_ASSET_STATE.CONFLICT);
		const plan = planReleaseReconciliation(state);
		assert.equal(plan.action, "abort");
		assert.deepEqual(plan.uploadNames, []);
		assert.match(plan.errors[0], /digest conflict/);
	});

	it("stops when a remote digest cannot be verified", () => {
		const locals = localAssets();
		const state = classifyReleaseAssets({
			releaseExists: true,
			localAssets: locals,
			remoteAssets: [{ ...locals[0], sha256: undefined }, ...locals.slice(1)],
		});
		assert.equal(state.state, RELEASE_ASSET_STATE.UNKNOWN);
		const plan = planReleaseReconciliation(state);
		assert.equal(plan.action, "abort");
		assert.match(plan.errors[0], /cannot verify remote digest/);
	});

	it("reports extras without deleting them", () => {
		const locals = localAssets();
		const state = classifyReleaseAssets({
			releaseExists: true,
			localAssets: locals,
			remoteAssets: [...locals, { name: "old-asset.zip", sha256: "e".repeat(64) }],
		});
		const plan = planReleaseReconciliation(state);
		assert.equal(plan.action, "none");
		assert.match(plan.warnings[0], /old-asset\.zip/);
	});
});

describe("local release assets", () => {
	it("adds the manifest and checksum files to the payload list", () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-release-assets-"));
		try {
			writeFileSync(join(dir, "install.sh"), "install");
			writeFileSync(join(dir, "omk-linux-x64.tar.gz"), "archive");
			const manifest = buildReleaseManifest({
				bundleDir: dir,
				tag: "v1.5.5",
				sourceSha: SOURCE_SHA,
				builtAt: "2026-10-22T00:00:00.000Z",
			});
			writeReleaseManifest(dir, manifest);
			const assets = localAssetsFromManifest(dir, manifest);
			assert.deepEqual(
				assets.map((asset) => asset.name),
				["install.sh", "omk-linux-x64.tar.gz", "release-manifest.json", "SHA256SUMS"],
			);
			assert.equal(assets.every((asset) => /^[0-9a-f]{64}$/.test(asset.sha256)), true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("reconcile-release arguments and commands", () => {
	it("parses required and optional flags", () => {
		const options = parseArgs(["--tag", "v1.5.5", "--bundle", "/tmp/bundle", "--apply", "--verify-downloads"]);
		assert.equal(options.tag, "v1.5.5");
		assert.equal(options.bundle, "/tmp/bundle");
		assert.equal(options.apply, true);
		assert.equal(options.verifyDownloads, true);
		assert.throws(() => parseArgs(["--bundle", "/tmp/bundle"]), /--tag is required/);
	});

	it("normalizes GitHub asset digests", () => {
		const assets = normalizeRemoteAssets([
			{ name: "a.tar.gz", digest: `sha256:${"a".repeat(64)}`, size: 4 },
			{ name: "b.tar.gz", size: 5 },
		]);
		assert.equal(assets[0].sha256, "a".repeat(64));
		assert.equal(assets[1].sha256, undefined);
	});

	it("builds create and upload commands without clobber", () => {
		const create = buildCreateArgs({
			tag: "v2.0.0-beta.1",
			notesFile: "/tmp/notes.md",
			prerelease: true,
			files: ["/tmp/a.tar.gz"],
		});
		assert.deepEqual(create.slice(0, 5), ["release", "create", "v2.0.0-beta.1", "--title", "v2.0.0-beta.1"]);
		assert.ok(create.includes("--prerelease"));
		assert.equal(create.at(-1), "/tmp/a.tar.gz");
		const upload = buildUploadArgs({ tag: "v1.5.5", files: ["/tmp/b.tar.gz"] });
		assert.deepEqual(upload, ["release", "upload", "v1.5.5", "/tmp/b.tar.gz"]);
		assert.equal(upload.includes("--clobber"), false);
	});
});
