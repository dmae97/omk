import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyArtifactReleaseGate } from "../lib/release-artifact-gate.mjs";

describe("P0-07: verifyArtifactReleaseGate", () => {
	const digestLinux = "a".repeat(64);
	const digestDarwin = "b".repeat(64);
	const digestTarball = "c".repeat(64);

	const validManifest = {
		schemaVersion: "omk.verified-release-artifacts.v1",
		version: "2.0.5",
		artifacts: [
			{ id: "open-multi-agent-kit-2.0.5.tgz", platform: "npm", sha256: digestTarball, installPassed: true, smokePassed: true },
			{ id: "omk-linux-x64", platform: "linux-x64", sha256: digestLinux, installPassed: true, smokePassed: true },
			{ id: "omk-darwin-arm64", platform: "darwin-arm64", sha256: digestDarwin, installPassed: true, smokePassed: true },
		],
	};

	it("passes only when every required platform passed install+smoke and exact SHA-256 matches the artifact to publish", () => {
		const res = verifyArtifactReleaseGate(
			validManifest,
			{
				"open-multi-agent-kit-2.0.5.tgz": digestTarball,
				"omk-linux-x64": digestLinux,
				"omk-darwin-arm64": digestDarwin,
			},
			["npm", "linux-x64", "darwin-arm64"],
		);
		assert.equal(res.allowed, true);
		assert.deepEqual(res.failures, []);
	});

	it("blocks release when a publish candidate digest differs from the verified artifact or a platform failed smoke", () => {
		const mutated = verifyArtifactReleaseGate(
			validManifest,
			{
				"open-multi-agent-kit-2.0.5.tgz": "f".repeat(64),
				"omk-linux-x64": digestLinux,
				"omk-darwin-arm64": digestDarwin,
			},
			["npm", "linux-x64", "darwin-arm64"],
		);
		assert.equal(mutated.allowed, false);
		assert.ok(mutated.failures.some((f) => /digest mismatch/i.test(f)));

		const missingPlatform = verifyArtifactReleaseGate(
			validManifest,
			{
				"open-multi-agent-kit-2.0.5.tgz": digestTarball,
				"omk-linux-x64": digestLinux,
			},
			["npm", "linux-x64", "windows-x64"],
		);
		assert.equal(missingPlatform.allowed, false);
		assert.ok(missingPlatform.failures.some((f) => /missing verified platform/i.test(f)));
	});

	it("publish.mjs enforces verifyArtifactReleaseGate on real tarball files and blocks tampered or unverified artifacts", async () => {
		const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const { sha256File } = await import("../lib/release-artifact-gate.mjs");
		const pub = await import("../publish.mjs");

		assert.equal(typeof pub.assertVerifiedPublishArtifacts, "function");
		const dir = mkdtempSync(join(tmpdir(), "omk-p04-pub-"));
		try {
			const tgzPath = join(dir, "open-multi-agent-kit-3.0.0.tgz");
			writeFileSync(tgzPath, "tarball-bytes-v1");
			const digest = sha256File(tgzPath);
			const manifestPath = join(dir, "verified-artifacts.json");
			writeFileSync(
				manifestPath,
				JSON.stringify({
					schemaVersion: "omk.verified-release-artifacts.v1",
					version: "3.0.0",
					artifacts: [
						{
							id: "open-multi-agent-kit-3.0.0.tgz",
							packageName: "open-multi-agent-kit",
							platform: "npm",
							sha256: digest,
							installPassed: true,
							smokePassed: true,
						},
					],
				}),
			);

			const verified = pub.assertVerifiedPublishArtifacts({
				manifestPath,
				artifactsDir: dir,
				expectedPackages: [{ name: "open-multi-agent-kit", version: "3.0.0" }],
				requiredPlatforms: ["npm"],
			});
			assert.equal(verified.get("open-multi-agent-kit").tarballPath, tgzPath);
			assert.equal(verified.get("open-multi-agent-kit").sha256, digest);

			// Tampering with the tarball after verification MUST fail the publisher gate
			writeFileSync(tgzPath, "tampered-tarball-bytes");
			assert.throws(
				() =>
					pub.assertVerifiedPublishArtifacts({
						manifestPath,
						artifactsDir: dir,
						expectedPackages: [{ name: "open-multi-agent-kit", version: "3.0.0" }],
						requiredPlatforms: ["npm"],
					}),
				/digest mismatch/i,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
