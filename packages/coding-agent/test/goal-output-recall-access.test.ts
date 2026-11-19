import { describe, expect, it } from "vitest";
import { isOtherRecallAccess, isRecallRead, RecallAccessTracker } from "../src/core/goal-output-recall-access.ts";

describe("goal-output-recall-access", () => {
	const cwd = "/repo";
	const absolutePath = "/repo/out.txt";

	describe("isRecallRead", () => {
		it.skipIf(process.platform === "win32")("matches read tool call with exact or @-prefixed path", () => {
			expect(isRecallRead("read", { path: "out.txt" }, cwd, absolutePath)).toBe(true);
			expect(isRecallRead("read", { path: "@out.txt" }, cwd, absolutePath)).toBe(true);
			expect(isRecallRead("read", { path: "/repo/out.txt" }, cwd, absolutePath)).toBe(true);
		});

		it("returns false for non-read tools or non-matching paths", () => {
			expect(isRecallRead("grep", { path: "out.txt" }, cwd, absolutePath)).toBe(false);
			expect(isRecallRead("read", { path: "other.txt" }, cwd, absolutePath)).toBe(false);
			expect(isRecallRead("read", { path: 123 }, cwd, absolutePath)).toBe(false);
			expect(isRecallRead("read", {}, cwd, absolutePath)).toBe(false);
			expect(isRecallRead("read", null, cwd, absolutePath)).toBe(false);
		});
	});

	describe("isOtherRecallAccess", () => {
		it.skipIf(process.platform === "win32")("matches grep tool referencing the recall path", () => {
			expect(isOtherRecallAccess("grep", { path: "/repo/out.txt" }, cwd, absolutePath)).toBe(true);
			expect(isOtherRecallAccess("grep", { path: "out.txt" }, cwd, absolutePath)).toBe(true);
		});

		it.skipIf(process.platform === "win32")(
			"matches bash readers naming the recall path with quotes stripped",
			() => {
				expect(isOtherRecallAccess("bash", { command: "cat out.txt" }, cwd, absolutePath)).toBe(true);
				expect(isOtherRecallAccess("bash", { command: "rg foo 'out.txt'" }, cwd, absolutePath)).toBe(true);
				expect(isOtherRecallAccess("bash", { command: 'grep pattern "out.txt"' }, cwd, absolutePath)).toBe(true);
				expect(isOtherRecallAccess("bash", { command: "sed -n '1p' out.txt" }, cwd, absolutePath)).toBe(true);
			},
		);

		it("returns false for non-reader shell commands or other tools", () => {
			expect(isOtherRecallAccess("bash", { command: "ls out.txt" }, cwd, absolutePath)).toBe(false);
			expect(isOtherRecallAccess("bash", { command: "echo out.txt" }, cwd, absolutePath)).toBe(false);
			expect(isOtherRecallAccess("bash", { command: "cat other.txt" }, cwd, absolutePath)).toBe(false);
			expect(isOtherRecallAccess("read", { path: "out.txt" }, cwd, absolutePath)).toBe(false);
			expect(isOtherRecallAccess("bash", {}, cwd, absolutePath)).toBe(false);
			expect(isOtherRecallAccess("bash", null, cwd, absolutePath)).toBe(false);
		});
	});

	describe("RecallAccessTracker", () => {
		it("returns undefined when take() is called before start()", () => {
			const tracker = new RecallAccessTracker();
			expect(tracker.take()).toBeUndefined();
		});

		it("returns undefined when started with undefined artifact", () => {
			const tracker = new RecallAccessTracker();
			tracker.start(undefined);
			expect(tracker.take()).toBeUndefined();
		});

		it.skipIf(process.platform === "win32")("tracks read calls and resets on take()", () => {
			const tracker = new RecallAccessTracker();
			tracker.start({ absolutePath });

			tracker.observe("read", { path: "out.txt" }, cwd);
			tracker.observe("read", { path: "@out.txt" }, cwd);

			expect(tracker.take()).toEqual({
				readAfterFollowUp: true,
				readCalls: 2,
				otherAccessCalls: 0,
			});

			expect(tracker.take()).toBeUndefined();
		});

		it.skipIf(process.platform === "win32")("tracks other access calls and mixed observations", () => {
			const tracker = new RecallAccessTracker();
			tracker.start({ absolutePath });

			tracker.observe("bash", { command: "cat out.txt" }, cwd);
			tracker.observe("grep", { path: "out.txt" }, cwd);
			tracker.observe("read", { path: "out.txt" }, cwd);

			expect(tracker.take()).toEqual({
				readAfterFollowUp: true,
				readCalls: 1,
				otherAccessCalls: 2,
			});

			expect(tracker.take()).toBeUndefined();
		});

		it("ignores observations when tracker has not been started", () => {
			const tracker = new RecallAccessTracker();
			tracker.observe("read", { path: "out.txt" }, cwd);
			expect(tracker.take()).toBeUndefined();
		});
	});
});
