/**
 * Normalize applied patch output into a canonical edit tool payload.
 */

import { generateUnifiedDiffString } from "./diff";
import { normalizeToLF, stripBom } from "./normalize";
import { parseHunks } from "./parser";
import type { PatchInput } from "./types";

export interface NormativePatchOptions {
	path: string;
	rename?: string;
	oldContent: string;
	newContent: string;
	contextLines?: number;
	anchor?: string | string[];
}

/** Normative patch input is the MongoDB-style update variant */

function applyAnchors(diff: string, anchors: Array<string | undefined> | undefined): string {
	if (!anchors || anchors.length === 0) {
		return diff;
	}
	const lines = diff.split("\n");
	let anchorIndex = 0;
	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].startsWith("@@")) continue;
		const anchor = anchors[anchorIndex];
		if (anchor !== undefined) {
			lines[i] = anchor.trim().length === 0 ? "@@" : `@@ ${anchor}`;
		}
		anchorIndex++;
	}
	return lines.join("\n");
}

function deriveAnchors(diff: string): Array<string | undefined> {
	const hunks = parseHunks(diff);
	return hunks.map((hunk) => {
		if (hunk.oldLines.length === 0 || hunk.newLines.length === 0) {
			return undefined;
		}
		const newLines = new Set(hunk.newLines);
		for (const line of hunk.oldLines) {
			const trimmed = line.trim();
			if (trimmed.length === 0) continue;
			if (!/[A-Za-z0-9_]/.test(trimmed)) continue;
			if (newLines.has(line)) {
				return trimmed;
			}
		}
		return undefined;
	});
}

export function buildNormativeUpdateInput(options: NormativePatchOptions): PatchInput {
	const normalizedOld = normalizeToLF(stripBom(options.oldContent).text);
	const normalizedNew = normalizeToLF(stripBom(options.newContent).text);
	const diffResult = generateUnifiedDiffString(normalizedOld, normalizedNew, options.contextLines ?? 3);
	let anchors: Array<string | undefined> | undefined =
		typeof options.anchor === "string" ? [options.anchor] : options.anchor;
	if (!anchors) {
		anchors = deriveAnchors(diffResult.diff);
	}
	const diff = applyAnchors(diffResult.diff, anchors);
	return {
		path: options.path,
		op: "update",
		rename: options.rename,
		diff,
	};
}
