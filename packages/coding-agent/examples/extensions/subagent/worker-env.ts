/**
 * Environment for subagent worker processes.
 *
 * Workers run headless (`-p`), so the finish check would add a verification turn
 * to every worker on top of the lead's own. Workers get it only when
 * `OMK_FINISH_CHECK_WORKERS` opts in. The lead's time budget, snapshot
 * handshake and fresh-context verifier (spec 032) describe the lead's run, so
 * they are not passed down.
 */
const LEAD_ONLY_VARS = [
	"OMK_TIME_BUDGET_SEC",
	"OMK_FINISH_CHECK_SNAPSHOT_DIR",
	"OMK_FINISH_CHECK_SNAPSHOT_TIMEOUT_SEC",
	"OMK_FINISH_CHECK_REVERIFY",
];

export function subagentWorkerEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...parent };
	for (const name of LEAD_ONLY_VARS) delete env[name];
	const optIn = parent.OMK_FINISH_CHECK_WORKERS?.trim();
	env.OMK_FINISH_CHECK = optIn ? optIn : "0";
	return env;
}
