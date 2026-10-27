import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Spec 061 regression. The hang is a microtask-only loop: vitest's in-process timeout never
// fires, so the scenario runs in a child vitest process killed by a hard wall-clock guard.
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const VITEST_BIN = fileURLToPath(new URL("../../../node_modules/vitest/vitest.mjs", import.meta.url));
// Generous: a child vitest needs ~9s to start, longer under full-suite load. The hang never ends.
const WALL_CLOCK_MS = 60_000;

function runScenario(
	filter: string,
): Promise<{ code: number | null; timedOut: boolean; elapsedMs: number; output: string }> {
	return new Promise((resolve) => {
		const started = performance.now();
		const child = spawn(
			process.execPath,
			[VITEST_BIN, "run", "--pool=forks", "test/scenarios/oversized-output-hang.scenario.test.ts", "-t", filter],
			{ cwd: PACKAGE_ROOT, env: { ...process.env, SPEC061_SCENARIO: "1" }, detached: true },
		);
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
		});
		let timedOut = false;
		const guard = setTimeout(() => {
			timedOut = true;
			// Kill the whole group: the vitest fork that spins is a grandchild.
			if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
		}, WALL_CLOCK_MS);
		child.on("close", (code) => {
			clearTimeout(guard);
			resolve({ code, timedOut, elapsedMs: performance.now() - started, output: output.slice(-4000) });
		});
	});
}

describe("spec 061: single tool output larger than the context window", () => {
	it(
		"settles within the wall-clock guard and reports the oversized tool output",
		async () => {
			const result = await runScenario("settles a prompt whose single tool output exceeds the window");
			expect({ timedOut: result.timedOut, code: result.code }, result.output).toEqual({ timedOut: false, code: 0 });
			expect(result.output).toMatch(/1 passed/);
			// The scenario's own prompt time, measured in the child (vitest startup excluded).
			const elapsed = Number(/061-elapsed-ms=(\d+)/.exec(result.output)?.[1] ?? Number.NaN);
			expect(elapsed).toBeLessThan(2_000);
		},
		WALL_CLOCK_MS + 15_000,
	);

	it(
		"does not cap overflow recovery that makes progress within one prompt (>= 3 compactions)",
		async () => {
			const result = await runScenario("completes one prompt that needs >= 3 overflow compactions");
			expect({ timedOut: result.timedOut, code: result.code }, result.output).toEqual({ timedOut: false, code: 0 });
			expect(result.output).toMatch(/1 passed/);
			expect(result.output).toMatch(/061-progress: overflowCompactions=([3-9]|\d{2,})/);
		},
		WALL_CLOCK_MS + 15_000,
	);

	it(
		"does not cap text-only overflow recovery within one prompt (>= 2 compactions)",
		async () => {
			const result = await runScenario("completes one prompt that recovers >= 2 overflows through text turns");
			expect({ timedOut: result.timedOut, code: result.code }, result.output).toEqual({ timedOut: false, code: 0 });
			expect(result.output).toMatch(/1 passed/);
		},
		WALL_CLOCK_MS + 15_000,
	);
});
