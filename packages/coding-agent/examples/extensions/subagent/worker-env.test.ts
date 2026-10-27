import { describe, expect, it } from "vitest";
import { subagentWorkerEnv } from "./worker-env.ts";

describe("subagentWorkerEnv", () => {
	it("passes the spawning session id only when the run log is on, never inherited", () => {
		const on = subagentWorkerEnv(
			{ OMK_RUN_LOG_DIR: "/tmp/rl", OMK_RUN_LOG_PARENT_SESSION: "old" },
			undefined,
			"lead-1",
		);
		expect(on.OMK_RUN_LOG_PARENT_SESSION).toBe("lead-1");
		expect(on.OMK_RUN_LOG_ROLE).toBe("worker");
		expect(
			subagentWorkerEnv({ OMK_RUN_LOG_DIR: "/tmp/rl", OMK_RUN_LOG_PARENT_SESSION: "old" })
				.OMK_RUN_LOG_PARENT_SESSION,
		).toBeUndefined();
		expect(subagentWorkerEnv({}, undefined, "lead-1").OMK_RUN_LOG_PARENT_SESSION).toBeUndefined();
	});

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

	it("keeps OMK_SKILL_SEARCH and turns automatic skill candidates off (spec 050 R7)", () => {
		const env = subagentWorkerEnv({ OMK_SKILL_SEARCH: "on", OMK_SKILL_SEARCH_SUGGEST: "1" });
		expect(env.OMK_SKILL_SEARCH).toBe("on");
		expect(env.OMK_SKILL_SEARCH_SUGGEST).toBe("0");
		expect(subagentWorkerEnv({}).OMK_SKILL_SEARCH_SUGGEST).toBe("0");
		const metacon = subagentWorkerEnv({ OMK_SKILL_SELECT: "metacon" });
		expect(metacon.OMK_SKILL_SELECT).toBe("metacon");
		expect(metacon.OMK_SKILL_SEARCH_SUGGEST).toBe("0");
	});

	it("turns typed todo checks off for workers (spec 049 R4)", () => {
		expect(subagentWorkerEnv({ OMK_TODO_VERIFY: "on" }).OMK_TODO_VERIFY).toBe("0");
		expect(subagentWorkerEnv({}).OMK_TODO_VERIFY).toBe("0");
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

	it("passes OMK_WORKER_EXTENSIONS through unchanged (spec 057 R8)", () => {
		expect(subagentWorkerEnv({ OMK_WORKER_EXTENSIONS: " my-mcp-adapter, /x/a.ts " }).OMK_WORKER_EXTENSIONS).toBe(
			" my-mcp-adapter, /x/a.ts ",
		);
		expect(subagentWorkerEnv({ OMK_WORKER_EXTENSIONS: "all" }).OMK_WORKER_EXTENSIONS).toBe("all");
		expect(subagentWorkerEnv({}).OMK_WORKER_EXTENSIONS).toBeUndefined();
	});

	it("does not modify the parent environment", () => {
		const parent = { OMK_TIME_BUDGET_SEC: "900" };
		subagentWorkerEnv(parent);
		expect(parent).toEqual({ OMK_TIME_BUDGET_SEC: "900" });
	});

	it("drops an inherited OMK_TRUST_PROJECT=1 and sets only the value it is given (spec 053)", () => {
		expect(subagentWorkerEnv({ OMK_TRUST_PROJECT: "1" }).OMK_TRUST_PROJECT).toBeUndefined();
		expect(subagentWorkerEnv({ OMK_TRUST_PROJECT: "1" }, "1").OMK_TRUST_PROJECT).toBe("1");
		expect(subagentWorkerEnv({}, "0").OMK_TRUST_PROJECT).toBe("0");
	});
});
