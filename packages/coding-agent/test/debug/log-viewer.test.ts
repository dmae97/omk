import { describe, expect, it } from "bun:test";
import { buildLogCopyPayload, DebugLogViewerModel, SESSION_BOUNDARY_WARNING } from "../../src/debug/log-viewer";

describe("DebugLogViewerModel", () => {
	it("inserts session boundary warning between older and current-session logs", () => {
		const processStartMs = Date.parse("2026-02-14T12:00:00.000Z");
		const logs = [
			'{"timestamp":"2026-02-14T11:59:00.000Z","level":"info","message":"old"}',
			'{"timestamp":"2026-02-14T11:59:30.000Z","level":"info","message":"old-2"}',
			'{"timestamp":"2026-02-14T12:00:05.000Z","level":"info","message":"current"}',
		].join("\n");

		const model = new DebugLogViewerModel(logs, processStartMs);
		const rowKinds = model.rows.map(row =>
			row.kind === "warning" ? SESSION_BOUNDARY_WARNING : `log:${row.logIndex}`,
		);

		expect(rowKinds).toEqual(["log:0", "log:1", SESSION_BOUNDARY_WARNING, "log:2"]);
	});

	it("filters logs with case-insensitive substring matching", () => {
		const logs = ["Alpha", "beta", "Gamma", "BETTER"].join("\n");
		const model = new DebugLogViewerModel(logs, Date.now());

		model.setFilterQuery("be");
		const rowKinds = model.rows.map(row =>
			row.kind === "warning" ? SESSION_BOUNDARY_WARNING : `log:${row.logIndex}`,
		);
		expect(rowKinds).toEqual(["log:1", "log:3"]);
		expect(model.visibleLogCount).toBe(2);
	});

	it("clamps cursor when filtered list shrinks", () => {
		const logs = ["alpha", "beta", "gamma"].join("\n");
		const model = new DebugLogViewerModel(logs, Date.now());

		model.moveCursor(2, false);
		expect(model.cursorLogIndex).toBe(2);

		model.setFilterQuery("alpha");
		expect(model.cursorLogIndex).toBe(0);
		expect(model.visibleLogCount).toBe(1);
	});

	it("resets selection anchor when filtered view drops the anchor log", () => {
		const logs = ["alpha", "beta", "gamma", "delta"].join("\n");
		const model = new DebugLogViewerModel(logs, Date.now());

		model.moveCursor(2, true);
		expect(model.getSelectedLogIndices()).toEqual([0, 1, 2]);

		model.setFilterQuery("beta");
		expect(model.getSelectedLogIndices()).toEqual([1]);
	});

	it("shows session boundary warning only when older and newer logs are visible", () => {
		const processStartMs = Date.parse("2026-02-14T12:00:00.000Z");
		const logs = [
			'{"timestamp":"2026-02-14T11:59:00.000Z","level":"info","message":"old"}',
			'{"timestamp":"2026-02-14T12:00:05.000Z","level":"info","message":"current"}',
			'{"timestamp":"2026-02-14T12:00:10.000Z","level":"info","message":"current-2"}',
		].join("\n");
		const model = new DebugLogViewerModel(logs, processStartMs);

		model.setFilterQuery("old");
		expect(model.rows.map(row => row.kind)).toEqual(["log"]);

		model.setFilterQuery("current-2");
		expect(model.rows.map(row => row.kind)).toEqual(["log"]);

		model.setFilterQuery("current");
		const rowKinds = model.rows.map(row =>
			row.kind === "warning" ? SESSION_BOUNDARY_WARNING : `log:${row.logIndex}`,
		);
		expect(rowKinds).toEqual(["log:1", "log:2"]);

		model.setFilterQuery("");
		const fullRowKinds = model.rows.map(row =>
			row.kind === "warning" ? SESSION_BOUNDARY_WARNING : `log:${row.logIndex}`,
		);
		expect(fullRowKinds).toEqual(["log:0", SESSION_BOUNDARY_WARNING, "log:1", "log:2"]);
	});

	it("copies only selected visible entries", () => {
		const logs = ["alpha", "bar", "baz"].join("\n");
		const model = new DebugLogViewerModel(logs, Date.now());

		model.setFilterQuery("ba");
		model.moveCursor(1, true);
		const payload = buildLogCopyPayload(model.getSelectedRawLines());
		expect(payload).toBe("bar\nbaz");
	});

	it("supports shift-range selection and reset on plain movement", () => {
		const logs = ["a", "b", "c", "d"].join("\n");
		const model = new DebugLogViewerModel(logs, Date.now());

		model.moveCursor(1, true);
		model.moveCursor(1, true);
		expect(model.getSelectedLogIndices()).toEqual([0, 1, 2]);

		model.moveCursor(1, false);
		expect(model.getSelectedLogIndices()).toEqual([3]);
	});

	it("expands and collapses all selected rows", () => {
		const logs = ["a", "b", "c"].join("\n");
		const model = new DebugLogViewerModel(logs, Date.now());

		model.moveCursor(1, true);
		model.expandSelected();
		expect(model.isExpanded(0)).toBe(true);
		expect(model.isExpanded(1)).toBe(true);

		model.collapseSelected();
		expect(model.isExpanded(0)).toBe(false);
		expect(model.isExpanded(1)).toBe(false);
	});
});

describe("buildLogCopyPayload", () => {
	it("joins selected lines and strips control/ansi sequences", () => {
		const payload = buildLogCopyPayload(["plain", "\u001b[31mred\u001b[0m", "ok\u0007", ""]);
		expect(payload).toBe("plain\nred\nok");
	});
});
