/**
 * Pure release-asset state machine.
 *
 * This module never calls GitHub or touches the filesystem. `reconcile-release.mjs`
 * provides the local and remote inventories; tests exercise the decision table
 * directly.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	CHECKSUM_FILE,
	RELEASE_MANIFEST_FILE,
	sha256File,
} from "./release-manifest.mjs";

export const RELEASE_ASSET_STATE = Object.freeze({
	ABSENT: "absent",
	PARTIAL: "partial",
	COMPLETE: "complete",
	CONFLICT: "conflict",
	UNKNOWN: "unknown",
});

export function localAssetsFromManifest(bundleDir, manifest) {
	const names = [
		...manifest.files,
		{ name: RELEASE_MANIFEST_FILE },
		{ name: CHECKSUM_FILE },
	];
	return names.map((file) => {
		const path = join(bundleDir, file.name);
		if (!existsSync(path)) throw new Error(`local release asset is missing: ${file.name}`);
		const stat = statSync(path);
		return { name: file.name, sha256: sha256File(path), bytes: stat.size };
	});
}

export function classifyReleaseAssets({ releaseExists, localAssets, remoteAssets }) {
	if (!releaseExists) {
		return {
			state: RELEASE_ASSET_STATE.ABSENT,
			missing: localAssets.map((asset) => asset.name),
			conflicts: [],
			unknown: [],
			extras: [],
		};
	}
	const remoteByName = new Map((remoteAssets ?? []).map((asset) => [asset.name, asset]));
	const localByName = new Map(localAssets.map((asset) => [asset.name, asset]));
	const missing = localAssets.filter((asset) => !remoteByName.has(asset.name)).map((asset) => asset.name);
	const conflicts = localAssets
		.filter((asset) => {
			const remote = remoteByName.get(asset.name);
			return remote !== undefined && remote.sha256 !== undefined && remote.sha256 !== asset.sha256;
		})
		.map((asset) => ({ name: asset.name, local: asset.sha256, remote: remoteByName.get(asset.name).sha256 }));
	const unknown = localAssets
		.filter((asset) => {
			const remote = remoteByName.get(asset.name);
			return remote !== undefined && remote.sha256 === undefined;
		})
		.map((asset) => asset.name);
	const extras = (remoteAssets ?? [])
		.filter((asset) => !localByName.has(asset.name))
		.map((asset) => asset.name)
		.sort((left, right) => left.localeCompare(right));

	if (conflicts.length > 0) {
		return { state: RELEASE_ASSET_STATE.CONFLICT, missing, conflicts, unknown, extras };
	}
	if (unknown.length > 0) {
		return { state: RELEASE_ASSET_STATE.UNKNOWN, missing, conflicts, unknown, extras };
	}
	if (missing.length > 0) {
		return { state: RELEASE_ASSET_STATE.PARTIAL, missing, conflicts, unknown, extras };
	}
	return { state: RELEASE_ASSET_STATE.COMPLETE, missing, conflicts, unknown, extras };
}

export function planReleaseReconciliation(state) {
	const warnings = [];
	if (state.extras.length > 0) {
		warnings.push(`release has extra assets that will not be deleted: ${state.extras.join(", ")}`);
	}
	switch (state.state) {
		case RELEASE_ASSET_STATE.ABSENT:
			return { action: "create", uploadNames: state.missing, warnings, errors: [] };
		case RELEASE_ASSET_STATE.PARTIAL:
			return { action: "upload", uploadNames: state.missing, warnings, errors: [] };
		case RELEASE_ASSET_STATE.COMPLETE:
			return { action: "none", uploadNames: [], warnings, errors: [] };
		case RELEASE_ASSET_STATE.CONFLICT:
			return {
				action: "abort",
				uploadNames: [],
				warnings,
				errors: state.conflicts.map(
					(conflict) => `digest conflict for ${conflict.name}: local ${conflict.local}, remote ${conflict.remote}`,
				),
			};
		case RELEASE_ASSET_STATE.UNKNOWN:
			return {
				action: "abort",
				uploadNames: [],
				warnings,
				errors: state.unknown.map(
					(name) => `cannot verify remote digest for ${name}; pass --verify-downloads or resolve manually`,
				),
			};
		default:
			return { action: "abort", uploadNames: [], warnings, errors: [`unknown release state: ${state.state}`] };
	}
}

export function summarizeState(state) {
	return {
		state: state.state,
		missing: state.missing,
		conflicts: state.conflicts,
		unknown: state.unknown,
		extras: state.extras,
	};
}
