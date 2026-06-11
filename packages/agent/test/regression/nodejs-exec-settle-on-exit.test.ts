import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { getOrThrow } from "../../src/harness/types.ts";
import { createTempDir } from "../harness/session-test-utils.ts";

// Hosts may have a locale configured that is not installed (e.g. LC_ALL=ko_KR.UTF-8),
// which makes spawned shells print a setlocale warning on stderr and break the exact
// stderr assertions below. Pin LC_ALL to the always-available C locale for this file.
const savedLcAll = process.env.LC_ALL;
beforeAll(() => {
	process.env.LC_ALL = "C";
});
afterAll(() => {
	if (savedLcAll === undefined) delete process.env.LC_ALL;
	else process.env.LC_ALL = savedLcAll;
});

// Regression: exec() used to settle only on the child "close" event, which waits for
// all stdio pipes to close. A background/daemon descendant inheriting stdout/stderr
// keeps the pipes open past the shell's exit, hanging exec and unbounding timeouts.
// exec must settle shortly after the shell exits instead.
describe("NodeExecutionEnv exec settles on exit, not close", () => {
	it.skipIf(process.platform === "win32")(
		"resolves promptly when a background child inherits the stdio pipes",
		async () => {
			const env = new NodeExecutionEnv({ cwd: createTempDir() });
			const start = Date.now();
			const result = getOrThrow(await env.exec("printf started; sleep 2 & exit 0"));
			const elapsed = Date.now() - start;
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("started");
			// Without the fix this waits for the backgrounded sleep (~2000 ms) to release
			// the inherited pipes; with the fix it settles within the short stdio grace.
			expect(elapsed).toBeLessThan(1500);
		},
	);

	it.skipIf(process.platform === "win32")(
		"bounds timeout settlement even when a descendant escapes the process group",
		async () => {
			const env = new NodeExecutionEnv({ cwd: createTempDir() });
			const start = Date.now();
			// The setsid'd child escapes killProcessTree's process-group SIGKILL and keeps
			// the inherited pipes open; the shell itself is killed by the timeout.
			const result = await env.exec("setsid sleep 5 & sleep 10", { timeout: 0.3 });
			const elapsed = Date.now() - start;
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error).toMatchObject({ code: "timeout" });
			// Without the fix this resolves only when the escaped sleep exits (~5000 ms);
			// with the fix it settles shortly after the timeout kill.
			expect(elapsed).toBeLessThan(2500);
		},
	);
});
