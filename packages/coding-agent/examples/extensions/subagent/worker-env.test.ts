import { describe, expect, it } from "vitest";
import { subagentWorkerEnv } from "./worker-env.ts";

describe("subagentWorkerEnv", () => {
	it("turns the finish check off for workers and keeps lead-only settings out", () => {
		const env = subagentWorkerEnv({
			PATH: "/bin",
			OMK_FINISH_CHECK: "always",
			OMK_TIME_BUDGET_SEC: "900",
			OMK_FINISH_CHECK_SNAPSHOT_DIR: "/opt/omk/snap",
			OMK_FINISH_CHECK_SNAPSHOT_TIMEOUT_SEC: "60",
		});
		expect(env.PATH).toBe("/bin");
		expect(env.OMK_FINISH_CHECK).toBe("0");
		expect(env.OMK_TIME_BUDGET_SEC).toBeUndefined();
		expect(env.OMK_FINISH_CHECK_SNAPSHOT_DIR).toBeUndefined();
		expect(env.OMK_FINISH_CHECK_SNAPSHOT_TIMEOUT_SEC).toBeUndefined();
	});

	it("turns the deliverable guard off for workers", () => {
		expect(subagentWorkerEnv({ OMK_DELIVERABLE_GUARD: "on" }).OMK_DELIVERABLE_GUARD).toBe("0");
		expect(subagentWorkerEnv({}).OMK_DELIVERABLE_GUARD).toBe("0");
	});

	it("lets OMK_FINISH_CHECK_WORKERS opt workers in", () => {
		expect(subagentWorkerEnv({ OMK_FINISH_CHECK_WORKERS: "1" }).OMK_FINISH_CHECK).toBe("1");
	});

	it("passes OMK_RUN_LOG_DIR down and marks the worker's log lines (spec 042)", () => {
		const env = subagentWorkerEnv({ OMK_RUN_LOG_DIR: "/logs/run-1" });
		expect(env.OMK_RUN_LOG_DIR).toBe("/logs/run-1");
		expect(env.OMK_RUN_LOG_ROLE).toBe("worker");
		expect(subagentWorkerEnv({ PATH: "/bin" }).OMK_RUN_LOG_ROLE).toBeUndefined();
	});

	it("does not modify the parent environment", () => {
		const parent = { OMK_TIME_BUDGET_SEC: "900" };
		subagentWorkerEnv(parent);
		expect(parent).toEqual({ OMK_TIME_BUDGET_SEC: "900" });
	});
});
