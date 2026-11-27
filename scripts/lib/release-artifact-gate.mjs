import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function sha256File(filePath) {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * Release artifact gate (P0-07):
 * Only the exact SHA-256 artifacts that passed install + smoke checks across every
 * required platform may be published.
 */
export function verifyArtifactReleaseGate(manifest, actualDigestsById, requiredPlatforms) {
	const failures = [];
	if (!manifest || manifest.schemaVersion !== "omk.verified-release-artifacts.v1") {
		return { allowed: false, failures: ["invalid or missing verified artifact manifest schemaVersion"] };
	}
	if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
		return { allowed: false, failures: ["verified artifact manifest has no artifacts"] };
	}

	const byPlatform = new Map();
	for (const art of manifest.artifacts) {
		if (!art || typeof art.id !== "string" || typeof art.platform !== "string") {
			failures.push("malformed artifact entry in manifest");
			continue;
		}
		if (!SHA256_HEX.test(art.sha256 ?? "")) {
			failures.push(`invalid sha256 digest in manifest for ${art.id}`);
		}
		if (art.installPassed !== true) {
			failures.push(`artifact ${art.id} (${art.platform}) did not pass install verification`);
		}
		if (art.smokePassed !== true) {
			failures.push(`artifact ${art.id} (${art.platform}) did not pass smoke verification`);
		}
		const actual = actualDigestsById?.[art.id];
		if (!actual) {
			failures.push(`missing actual artifact digest for ${art.id}`);
		} else if (actual !== art.sha256) {
			failures.push(`digest mismatch for ${art.id}: verified ${art.sha256}, actual ${actual}`);
		}
		byPlatform.set(art.platform, art);
	}

	for (const platform of requiredPlatforms ?? []) {
		if (!byPlatform.has(platform)) {
			failures.push(`missing verified platform: ${platform}`);
		}
	}

	return { allowed: failures.length === 0, failures };
}
