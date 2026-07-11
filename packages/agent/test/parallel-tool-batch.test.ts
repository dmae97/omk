import { describe, expect, it } from "vitest";
import {
	extractParallelScopePath,
	isDestructiveBashCommand,
	pathsOverlap,
	shouldParallelizeToolBatch,
} from "../src/parallel-tool-batch.ts";

describe("isDestructiveBashCommand", () => {
	it("detects rm and redirect overwrite", () => {
		expect(isDestructiveBashCommand("rm -rf /tmp/x")).toBe(true);
		expect(isDestructiveBashCommand("echo hi > out.txt")).toBe(true);
		expect(isDestructiveBashCommand("echo hi >> out.txt")).toBe(false);
		expect(isDestructiveBashCommand("ls -la")).toBe(false);
	});
});

describe("pathsOverlap", () => {
	it("detects same file and parent/child paths", () => {
		expect(pathsOverlap("/a/b/c.ts", "/a/b/c.ts")).toBe(true);
		expect(pathsOverlap("/a/b", "/a/b/c.ts")).toBe(true);
		expect(pathsOverlap("/a/b/c.ts", "/a/x/c.ts")).toBe(false);
	});
});

describe("extractParallelScopePath", () => {
	it("resolves relative paths against cwd", () => {
		const scoped = extractParallelScopePath("read", { path: "src/foo.ts" }, "/proj");
		expect(scoped).toBe("/proj/src/foo.ts");
	});
});

describe("shouldParallelizeToolBatch", () => {
	const cwd = "/proj";

	it("returns false for single or empty batches", () => {
		expect(shouldParallelizeToolBatch([], { cwd })).toBe(false);
		expect(shouldParallelizeToolBatch([{ name: "read", arguments: { path: "a.ts" } }], { cwd })).toBe(false);
	});

	it("allows parallel reads on disjoint paths", () => {
		expect(
			shouldParallelizeToolBatch(
				[
					{ name: "read", arguments: { path: "a.ts" } },
					{ name: "read", arguments: { path: "b.ts" } },
				],
				{ cwd },
			),
		).toBe(true);
	});

	it("rejects overlapping read paths", () => {
		expect(
			shouldParallelizeToolBatch(
				[
					{ name: "read", arguments: { path: "src/a.ts" } },
					{ name: "read", arguments: { path: "src/a.ts" } },
				],
				{ cwd },
			),
		).toBe(false);
	});

	it("rejects write/edit with overlapping paths", () => {
		expect(
			shouldParallelizeToolBatch(
				[
					{ name: "write", arguments: { path: "src/x.ts" } },
					{ name: "edit", arguments: { path: "src/x.ts" } },
				],
				{ cwd },
			),
		).toBe(false);
	});

	it("rejects bash mixed with other tools", () => {
		expect(
			shouldParallelizeToolBatch(
				[
					{ name: "bash", arguments: { command: "ls" } },
					{ name: "read", arguments: { path: "a.ts" } },
				],
				{ cwd },
			),
		).toBe(false);
	});

	it("rejects multiple bash calls", () => {
		expect(
			shouldParallelizeToolBatch(
				[
					{ name: "bash", arguments: { command: "pwd" } },
					{ name: "bash", arguments: { command: "whoami" } },
				],
				{ cwd },
			),
		).toBe(false);
	});

	it("rejects destructive bash even alone in a multi-tool batch", () => {
		expect(
			shouldParallelizeToolBatch(
				[
					{ name: "bash", arguments: { command: "rm foo" } },
					{ name: "grep", arguments: { pattern: "x" } },
				],
				{ cwd },
			),
		).toBe(false);
	});

	it("allows parallel grep and find", () => {
		expect(
			shouldParallelizeToolBatch(
				[
					{ name: "grep", arguments: { pattern: "foo" } },
					{ name: "find", arguments: { pattern: "*.ts" } },
				],
				{ cwd },
			),
		).toBe(true);
	});

	it("rejects unknown tools in batch", () => {
		expect(
			shouldParallelizeToolBatch(
				[
					{ name: "read", arguments: { path: "a.ts" } },
					{ name: "custom_tool", arguments: {} },
				],
				{ cwd },
			),
		).toBe(false);
	});

	it("allows extension tools with executionMode parallel", () => {
		const policies = new Map<string, "sequential" | "parallel">([["echo", "parallel"]]);
		expect(
			shouldParallelizeToolBatch(
				[
					{ name: "echo", arguments: { value: "first" } },
					{ name: "echo", arguments: { value: "second" } },
				],
				{ cwd, toolPolicies: policies, allowUnknownParallel: (n) => policies.get(n) === "parallel" },
			),
		).toBe(true);
	});
});
