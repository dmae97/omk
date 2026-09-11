import { afterEach, describe, expect, it } from "vitest";
import type { BashOperations } from "../../src/core/tools/bash.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness | undefined;
afterEach(() => {
	harness?.cleanup();
	harness = undefined;
});
function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function command() {
	const entered = deferred();
	const finish = deferred();
	let signal: AbortSignal | undefined;
	const operations: BashOperations = {
		exec: async (_command, _cwd, options) => {
			signal = options.signal;
			entered.resolve();
			await finish.promise;
			return { exitCode: 0 };
		},
	};
	return { entered, finish, operations, signal: () => signal };
}

describe("interactive bash execution ownership", () => {
	it("starts no operation when cancellation wins during permit admission", async () => {
		harness = await createHarness({ settings: { resourceGovernor: { mode: "off" } } });
		let starts = 0;
		const pending = harness.session.executeBash("printf cancelled", undefined, {
			operations: {
				exec: async () => {
					starts += 1;
					return { exitCode: 0 };
				},
			},
		});
		harness.session.abortBash();
		const result = await pending;
		expect(starts).toBe(0);
		expect(result.cancelled).toBe(true);
		expect(harness.session.isBashRunning).toBe(false);
	});
	it("does not forget a second command when the first returns", async () => {
		harness = await createHarness({ settings: { resourceGovernor: { mode: "off" } } });
		const first = command();
		const second = command();
		const firstRun = harness.session.executeBash("printf first", undefined, { operations: first.operations });
		await first.entered.promise;
		const secondRun = harness.session.executeBash("printf second", undefined, { operations: second.operations });
		await second.entered.promise;
		try {
			first.finish.resolve();
			await firstRun;
			expect(harness.session.isBashRunning).toBe(true);
			harness.session.abortBash();
			expect(second.signal()?.aborted).toBe(true);
		} finally {
			first.finish.resolve();
			second.finish.resolve();
			await Promise.all([firstRun, secondRun]);
		}
		expect(harness.session.isBashRunning).toBe(false);
	});

	it("gives concurrent commands distinct signals and cancels every owned command", async () => {
		harness = await createHarness({ settings: { resourceGovernor: { mode: "off" } } });
		const first = command();
		const second = command();
		const runs = [
			harness.session.executeBash("printf first", undefined, { operations: first.operations }),
			harness.session.executeBash("printf second", undefined, { operations: second.operations }),
		];
		try {
			await Promise.all([first.entered.promise, second.entered.promise]);
			expect(first.signal()).not.toBe(second.signal());
			harness.session.abortBash();
			expect(first.signal()?.aborted).toBe(true);
			expect(second.signal()?.aborted).toBe(true);
			expect(harness.session.isBashRunning).toBe(true);
		} finally {
			first.finish.resolve();
			second.finish.resolve();
			await Promise.all(runs);
		}
		expect(harness.session.isBashRunning).toBe(false);
	});
});
