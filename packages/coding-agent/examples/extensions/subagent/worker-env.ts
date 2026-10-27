/**
 * Environment for subagent worker processes.
 *
 * Workers run headless (`-p`), so the finish check would add a verification turn
 * to every worker on top of the lead's own. Workers get it only when
 * `OMK_FINISH_CHECK_WORKERS` opts in. The lead's time budget, snapshot
 * handshake and fresh-context verifier (spec 032) describe the lead's run, so
 * they are not passed down. Workers keep `OMK_RUN_LOG_DIR` and are marked
 * `OMK_RUN_LOG_ROLE=worker` (spec 042) so their lines can be told apart from
 * the lead's. The deliverable guard (spec 034) watches the lead's outputs only,
 * so workers always get it off. The project trust env (spec 053) is not inherited:
 * the caller passes `OMK_TRUST_PROJECT` only when the parent trusted its project and
 * the worker cwd's gated items hash the same (`workerProjectTrustEnv`), or "0" when
 * the parent runs with it forced off. Workers inherit `OMK_SKILL_SEARCH` and
 * `OMK_SKILL_SELECT` (spec 058 R1) but never get automatic skill candidate
 * messages (spec 050 R7). Skill auto-load (spec 117) is always off in workers: they get only the parent's
 * admitted skills through `--skill`.
 * `OMK_WORKER_EXTENSIONS` passes through unchanged (spec 057 R8), so a worker that
 * spawns its own workers applies the same rule.
 * Typed todo checks (spec 049) belong to the lead; workers always get `OMK_TODO_VERIFY` off.
 * Adaptive reasoning effort (spec 037) is always off in workers.
 * With the run log on, `OMK_RUN_LOG_PARENT_SESSION` carries the spawning session's id (never inherited).
 */
const LEAD_ONLY_VARS = [
	"OMK_TIME_BUDGET_SEC",
	"OMK_FINISH_CHECK_SNAPSHOT_DIR",
	"OMK_FINISH_CHECK_SNAPSHOT_TIMEOUT_SEC",
	"OMK_FINISH_CHECK_REVERIFY",
];

export function subagentWorkerEnv(
	parent: NodeJS.ProcessEnv,
	projectTrust?: "1" | "0",
	leadSessionId?: string,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...parent };
	for (const name of LEAD_ONLY_VARS) delete env[name];
	delete env.OMK_TRUST_PROJECT;
	if (projectTrust) env.OMK_TRUST_PROJECT = projectTrust;
	const optIn = parent.OMK_FINISH_CHECK_WORKERS?.trim();
	env.OMK_FINISH_CHECK = optIn ? optIn : "0";
	env.OMK_DELIVERABLE_GUARD = "0";
	// Spec 050 R7: workers keep OMK_SKILL_SEARCH (the `skill_search` tool) but get no automatic candidates.
	env.OMK_SKILL_SEARCH_SUGGEST = "0";
	env.OMK_SKILL_AUTO_LOAD = "0"; // spec 117: auto-load is default on, so workers opt out explicitly (AL7)
	env.OMK_TODO_VERIFY = "0";
	env.OMK_ADAPTIVE_EFFORT = "0";
	delete env.OMK_RUN_LOG_PARENT_SESSION;
	if (parent.OMK_RUN_LOG_DIR?.trim()) {
		env.OMK_RUN_LOG_ROLE = "worker";
		// Run-log lines from the worker name the spawning session (edit-match parentSessionId).
		if (leadSessionId) env.OMK_RUN_LOG_PARENT_SESSION = leadSessionId;
	}
	return env;
}
