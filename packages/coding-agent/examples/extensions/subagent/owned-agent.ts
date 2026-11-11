import type { SubagentLaneAuthority } from "open-multi-agent-kit";
import { blockedResult, laneResult } from "./graph-result.ts";
import type { SingleResult } from "./subagent-runtime-types.ts";

/** Single and chain launches use the same admission and settlement owner as graph and parallel work. */
export async function runOwnedAgent(
	authority: SubagentLaneAuthority,
	input: {
		readonly agent: string;
		readonly task: string;
		readonly step?: number;
		readonly signal?: AbortSignal;
		readonly launch: (signal: AbortSignal | undefined) => Promise<SingleResult>;
	},
): Promise<SingleResult> {
	const id = input.step === undefined ? "single" : `step-${input.step}`;
	let result: SingleResult | undefined;
	const dispatch = await authority.dispatchLanes({
		lanes: [{ id, role: "executor", task: input.task, agentName: input.agent }],
		configuredMaxParallelLanes: 1,
		heavyLaneIds: authority.getCurrentResourceAdmission() ? new Set([id]) : undefined,
		signal: input.signal,
		launchLane: async ({ signal }) => {
			result = await input.launch(signal);
			return laneResult(result);
		},
	});
	return (
		result ?? {
			...blockedResult(
				{ id, agent: input.agent, task: input.task },
				dispatch.blockers.join("; ") || dispatch.outcomes[0]?.status || "admission-deferred",
			),
			step: input.step,
		}
	);
}
