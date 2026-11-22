import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parsePatch } from "diff";
import { describe, expect, it, vi } from "vitest";

const patches = parsePatch(
	readFileSync(fileURLToPath(new URL("../resources/native-subagents/0.78.0.patch", import.meta.url)), "utf8"),
);
function repairedSections(path: string): string {
	return patches
		.find((patch) => patch.newFileName === path)!
		.hunks.map((hunk) =>
			hunk.lines
				.filter((line) => !line.startsWith("-"))
				.map((line) => line.slice(1))
				.join("\n"),
		)
		.join("\n");
}
const child = repairedSections("src/runs/shared/child-session.js");
const foreground = repairedSections("src/runs/foreground/execution.js");
const runtimeStart = child.indexOf("    const createRuntime = async (pi) => {");
const runtime = child.slice(runtimeStart, child.indexOf("    const sharedRuntime", runtimeStart));
const modelStart = child.indexOf("                let resolvedModel;");
const model = child.slice(modelStart, child.indexOf("                const { session }", modelStart));
const mcpStart = child.indexOf('                    if (typeof session.attachMcpServers === "function"');
const mcp = child.slice(mcpStart, child.indexOf("\n                }", mcpStart));
const closeStart = child.indexOf('                    if (typeof session.close === "function")');
const close = child.slice(closeStart, child.indexOf("\n                }", closeStart));

describe("shipped native SDK and lifecycle repairs", () => {
	it("creates native auth and registry without obsolete SDK exports", async () => {
		const storage = {};
		const registry = {};
		const pi = { AuthStorage: { create: vi.fn(() => storage) }, ModelRegistry: { create: vi.fn(() => registry) } };
		const result = await vm.runInNewContext(`(async () => { ${runtime}; return createRuntime(pi); })()`, { pi });
		expect(result).toEqual({ authStorage: storage, modelRegistry: registry });
		expect(pi.ModelRegistry.create).toHaveBeenCalledWith(storage);
		expect(child).toContain("modelRegistry: modelRuntime,");
		expect(child).not.toContain("pi.ModelRuntime.create()");
	});

	function resolveModel(request: string, models: { provider: string; id: string }[]) {
		return vm.runInNewContext(`(() => { ${model}; return resolvedModel; })()`, {
			launch: { model: request },
			modelRuntime: { getAll: () => models },
			splitKnownThinkingSuffix: (value: string) => ({
				baseModel: value.replace(/:high$/, ""),
				thinkingSuffix: ":high",
			}),
		});
	}

	it("selects the exact provider/id before interpreting a thinking suffix", () => {
		const selected = { provider: "fixture", id: "model:high" };
		expect(resolveModel("fixture/model:high", [selected])).toEqual({ model: selected });
	});

	it("retains a recognized thinking suffix without falling back to a different model", () => {
		const selected = { provider: "fixture", id: "model" };
		expect(resolveModel("fixture/model:high", [selected])).toEqual({ model: selected, thinkingLevel: "high" });
		expect(() => resolveModel("other/model:high", [selected])).toThrow(/unavailable in the host registry/);
	});

	it.each([
		{ tools: ["fixture__selected"], expected: 1 },
		{ tools: ["bash"], expected: 0 },
		{ tools: ["fixture__selected"], excludeTools: ["fixture__selected"], expected: 0 },
		{ tools: ["fixture__selected"], denied: true, expected: 0 },
	])(
		"respects selected MCP tools, exclusions and capability ceilings %#",
		async ({ tools, excludeTools, denied, expected }) => {
			const session = { attachMcpServers: vi.fn(async () => {}) };
			await vm.runInNewContext(`(async () => { ${mcp} })()`, {
				session,
				launch: { tools, excludeTools, runtime: { capabilityCeiling: { denyExtensions: denied } } },
			});
			expect(session.attachMcpServers).toHaveBeenCalledTimes(expected);
		},
	);

	it("awaits native closure and propagates a close failure", async () => {
		const session = {
			close: vi.fn(async () => {
				throw new Error("close failed");
			}),
			dispose: vi.fn(),
		};
		await expect(vm.runInNewContext(`(async () => { ${close} })()`, { session })).rejects.toThrow("close failed");
		expect(session.dispose).not.toHaveBeenCalled();
	});

	it("retains disposal for SDKs without asynchronous close", async () => {
		const session = { dispose: vi.fn() };
		await vm.runInNewContext(`(async () => { ${close} })()`, { session });
		expect(session.dispose).toHaveBeenCalledOnce();
	});

	it("does not prompt after startup has consumed the absolute deadline or admission was cancelled", async () => {
		const start = foreground.indexOf("                // Creation and host callbacks may consume");
		const guard = foreground.slice(start, foreground.indexOf("\n            }", start));
		for (const flag of ["expired", "abortedBySignal", "interruptedByControl", "hostStopReason"]) {
			const prompt = vi.fn();
			const result = { timedOut: false };
			await vm.runInNewContext(`(async () => { ${guard} })()`, {
				attemptTimeout: {},
				options: {},
				result,
				created: { prompt },
				task: "fixture",
				resolveAttemptTimeout: () => ({ remainingMs: flag === "expired" ? 0 : 1000 }),
				timeoutAttempt: () => {
					result.timedOut = true;
				},
				abortedBySignal: flag === "abortedBySignal",
				interruptedByControl: flag === "interruptedByControl",
				hostStopReason: flag === "hostStopReason" ? "stopped" : undefined,
				settle: vi.fn(),
			});
			expect(prompt).not.toHaveBeenCalled();
		}
		expect(foreground).toContain("if (afterCompactionSettlement && !sessionDisposalFailed)");
		expect(foreground).toContain("if (interruptedByControl && !sessionDisposalFailed)");
	});
});
