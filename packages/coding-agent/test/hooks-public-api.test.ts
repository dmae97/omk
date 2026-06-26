import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	createFailClosedToolCallResult,
	createFailClosedToolResult,
	DEFAULT_HOOK_POLICY,
	FAIL_CLOSED_REASON,
	formatFailClosedReason,
	sanitizeHookFailure,
	sanitizeHookPolicy,
} from "../src/core/hooks/index.ts";

interface PackageJson {
	exports?: Record<string, { types?: string; import?: string }>;
}

function readPackageJson(): PackageJson {
	return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as PackageJson;
}

function collectObjectKeys(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.flatMap((entry) => collectObjectKeys(entry));
	}
	if (typeof value !== "object" || value === null) {
		return [];
	}
	return Object.entries(value).flatMap(([key, nested]) => [key, ...collectObjectKeys(nested)]);
}

describe("public hooks API", () => {
	it("has source files for the package ./hooks export", () => {
		const packageJson = readPackageJson();
		const hooksExport = packageJson.exports?.["./hooks"];

		expect(hooksExport).toEqual({
			types: "./dist/core/hooks/index.d.ts",
			import: "./dist/core/hooks/index.js",
		});
		expect(existsSync(new URL("../src/core/hooks/index.ts", import.meta.url))).toBe(true);
		expect(existsSync(new URL("../src/core/hooks/types.ts", import.meta.url))).toBe(true);
		expect(existsSync(new URL("../src/core/hooks/fail-closed.ts", import.meta.url))).toBe(true);
	});

	it("formats only a generic fail-closed reason", () => {
		const reason = formatFailClosedReason({ command: "rm -rf /home/yu/omk", stack: "at /home/yu/private.ts" });

		expect(reason).toBe(FAIL_CLOSED_REASON);
		expect(reason).not.toContain("/home/");
		expect(reason).not.toContain("rm -rf");
	});

	it("creates a fail-closed tool call result", () => {
		expect(createFailClosedToolCallResult()).toEqual({
			block: true,
			reason: FAIL_CLOSED_REASON,
		});
	});

	it("creates a fail-closed tool result with sanitized details", () => {
		const result = createFailClosedToolResult({
			code: "hook_timeout",
			stage: "tool_call",
			cause: "raw cause should not be copied",
			stack: "Error: secret\n    at /home/yu/omk/private.ts:1:1",
			command: "rm -rf /home/yu/omk",
			content: "private file contents",
			path: "/home/yu/omk/private.ts",
		});

		expect(Object.keys(result).sort()).toEqual(["content", "details", "isError"]);
		expect(result.isError).toBe(true);
		expect(result.content).toEqual([{ type: "text", text: FAIL_CLOSED_REASON }]);
		expect(result.details).toEqual({
			type: "hook_failure",
			sanitized: true,
			code: "hook_timeout",
			stage: "tool_call",
		});
		expect(Object.isFrozen(result.details)).toBe(true);

		const detailKeys = collectObjectKeys(result.details);
		expect(detailKeys).not.toContain("cause");
		expect(detailKeys).not.toContain("stack");
		expect(detailKeys).not.toContain("command");
		expect(detailKeys).not.toContain("content");
		expect(detailKeys).not.toContain("path");
		expect(JSON.stringify(result.details)).not.toMatch(/\/(?:home|Users|tmp|var|etc)\//);
	});

	it("sanitizes unknown hook failure input to bounded defaults", () => {
		expect(sanitizeHookFailure({ code: "raw /home/yu/path", stage: "stack trace" })).toEqual({
			type: "hook_failure",
			sanitized: true,
			code: "hook_failed",
			stage: "unknown",
		});
	});

	it("normalizes malformed hook policy input to safe fail-closed defaults", () => {
		const policy = sanitizeHookPolicy({
			stages: ["tool_result", "raw /home/yu/path", "tool_call", "tool_result"],
			effects: ["mutator", "command rm -rf /home/yu/omk", "validator"],
			failureMode: "fail-open",
			timeoutMs: 1_000_000,
			cause: "raw cause should not be copied",
			command: "rm -rf /home/yu/omk",
			path: "/home/yu/omk/private.sh",
		});

		expect(policy).toEqual({
			stages: ["tool_call", "tool_result"],
			effects: ["validator", "mutator"],
			failureMode: "fail-closed",
			timeoutMs: DEFAULT_HOOK_POLICY.timeoutMs,
		});
		expect(JSON.stringify(policy)).not.toMatch(/\/home\/yu|rm -rf|raw cause|private\.sh/);
	});

	it("returns immutable hook policy metadata in canonical runtime order", () => {
		const policy = sanitizeHookPolicy({
			stages: ["session_stop", "tool_result", "pre_compact", "tool_call", "session_start"],
			effects: ["observer", "mutator", "validator"],
			failureMode: "fail-open",
			timeoutMs: 10_000,
		});

		expect(policy).toEqual({
			stages: ["tool_call", "tool_result", "session_start", "pre_compact", "session_stop"],
			effects: ["validator", "mutator", "observer"],
			failureMode: "fail-closed",
			timeoutMs: 10_000,
		});
		expect(Object.isFrozen(policy)).toBe(true);
		expect(Object.isFrozen(policy.stages)).toBe(true);
		expect(Object.isFrozen(policy.effects)).toBe(true);
	});
});
