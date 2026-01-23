import { describe, expect, it } from "bun:test";
import { createTempDirSync } from "@oh-my-pi/pi-utils";
import { executePython } from "$c/ipy/executor";
import type { KernelExecuteOptions, KernelExecuteResult } from "$c/ipy/kernel";
import { PythonKernel } from "$c/ipy/kernel";

interface KernelStub {
	execute: (code: string, options?: KernelExecuteOptions) => Promise<KernelExecuteResult>;
	shutdown: () => Promise<void>;
}

describe("executePython (per-call)", () => {
	it("shuts down kernel on timed-out cancellation", async () => {
		process.env.OMP_PYTHON_SKIP_CHECK = "1";
		using tempDir = createTempDirSync("@omp-python-executor-per-call-");

		let shutdownCalls = 0;
		const kernel: KernelStub = {
			execute: async () => ({
				status: "ok",
				cancelled: true,
				timedOut: true,
				stdinRequested: false,
			}),
			shutdown: async () => {
				shutdownCalls += 1;
			},
		};

		const kernelClass = PythonKernel as unknown as {
			start: (options: { cwd: string }) => Promise<KernelStub>;
		};
		const originalStart = kernelClass.start;
		kernelClass.start = async () => kernel;

		try {
			const result = await executePython("sleep(10)", {
				kernelMode: "per-call",
				timeoutMs: 2000,
				cwd: tempDir.path,
			});

			expect(result.cancelled).toBe(true);
			expect(result.exitCode).toBeUndefined();
			expect(result.output).toContain("Command timed out after 2 seconds");
			expect(shutdownCalls).toBe(1);
		} finally {
			kernelClass.start = originalStart;
		}
	});
});
