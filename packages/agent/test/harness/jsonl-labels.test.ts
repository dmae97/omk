import { describe, expect, it } from "vitest";
import { buildLabelsById, updateLabelCache } from "../../src/harness/session/jsonl-labels.ts";
import type { LabelEntry, MessageEntry } from "../../src/harness/types.ts";
import { createUserMessage } from "./session-test-utils.ts";

function labelEntry(targetId: string, label: string | undefined, id = `label-${targetId}`): LabelEntry {
	return {
		type: "label",
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		targetId,
		label,
	};
}

function messageEntry(id = "message-1"): MessageEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		message: createUserMessage("hello"),
	};
}

describe("updateLabelCache", () => {
	it("stores a label trimmed of surrounding whitespace", () => {
		const labelsById = new Map<string, string>();
		updateLabelCache(labelsById, labelEntry("a", " first "));
		expect(labelsById.get("a")).toBe("first");
	});

	it("replaces the earlier label for the same targetId", () => {
		const labelsById = new Map<string, string>();
		updateLabelCache(labelsById, labelEntry("a", "first"));
		updateLabelCache(labelsById, labelEntry("a", "second", "label-a-2"));
		expect(labelsById.get("a")).toBe("second");
		expect(labelsById.size).toBe(1);
	});

	it("removes the label when the new label is only whitespace", () => {
		const labelsById = new Map([["a", "first"]]);
		updateLabelCache(labelsById, labelEntry("a", "   "));
		expect(labelsById.has("a")).toBe(false);
	});

	it("removes the label when the new label is undefined", () => {
		const labelsById = new Map([["a", "first"]]);
		updateLabelCache(labelsById, labelEntry("a", undefined));
		expect(labelsById.has("a")).toBe(false);
	});

	it("leaves the map unchanged for non-label entries", () => {
		const labelsById = new Map([["a", "first"]]);
		updateLabelCache(labelsById, messageEntry());
		expect(labelsById).toEqual(new Map([["a", "first"]]));
	});
});

describe("buildLabelsById", () => {
	it("returns only the final surviving labels over a mixed list", () => {
		const entries = [
			labelEntry("a", " first "),
			labelEntry("b", "keep"),
			labelEntry("a", "second", "label-a-2"),
			messageEntry(),
			labelEntry("b", "   ", "label-b-2"),
		];
		expect(buildLabelsById(entries)).toEqual(new Map([["a", "second"]]));
	});

	it("returns an empty map when every label is removed", () => {
		const entries = [labelEntry("a", "first"), labelEntry("a", undefined, "label-a-2")];
		expect(buildLabelsById(entries)).toEqual(new Map());
	});
});
