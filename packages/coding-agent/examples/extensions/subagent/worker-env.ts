/**
 * Environment for subagent worker processes.
 *
 * Workers run headless (`-p`), so the finish check would add a verification turn
 * to every worker on top of the lead's own. Workers get it only when
 * `OMK_FINISH_CHECK_WORKERS` opts in. The lead's time budget and snapshot
 * handshake describe the lead's run, so they are not passed down. Workers keep
 * `OMK_RUN_LOG_DIR` and are marked `OMK_RUN_LOG_ROLE=worker` (spec 042) so their
 * lines can be told apart from the lead's.
 */
const LEAD_ONLY_VARS = [
	"OMK_TIME_BUDGET_SEC",
	"OMK_FINISH_CHECK_SNAPSHOT_DIR",
	"OMK_FINISH_CHECK_SNAPSHOT_TIMEOUT_SEC",
];

export function subagentWorkerEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...parent };
	for (const name of LEAD_ONLY_VARS) delete env[name];
	const optIn = parent.OMK_FINISH_CHECK_WORKERS?.trim();
	env.OMK_FINISH_CHECK = optIn ? optIn : "0";
	if (parent.OMK_RUN_LOG_DIR?.trim()) env.OMK_RUN_LOG_ROLE = "worker";
	return env;
}
