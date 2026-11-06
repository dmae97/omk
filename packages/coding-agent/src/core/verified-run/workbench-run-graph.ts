import { GENESIS_PREVIOUS } from "./authority-journal.ts";
import { type AuthorityStoreView, inspectRunAuthority } from "./authority-runtime.ts";
import { type RunExplanation, readRunExplanation } from "./explanation.ts";
import type { RunProjection } from "./run-types.ts";
import { stateRunPath, VerifiedRunConcurrentChangeError } from "./storage.ts";

export const RUN_GRAPH_VERSION = "omk.run-graph.v1" as const;

/** Observation only: neither graph coordinates nor this snapshot grant execution authority. */
export interface RunGraphSnapshot {
	readonly schemaVersion: typeof RUN_GRAPH_VERSION;
	readonly runtime: "node";
	readonly graphKind: "verified-run";
	readonly executionRequested: false;
	readonly capabilities: { readonly execute: false; readonly amendGraph: false };
	readonly runId: string;
	readonly cursor: RunExplanation["binding"] & {
		readonly revision: number;
		readonly generation: number;
		readonly authorityRevision: number;
		readonly authorityDigest: string;
	};
	readonly state: Pick<RunProjection, "execution" | "settlement" | "verification" | "application" | "publication">;
	readonly proofVerdict: RunExplanation["proof"]["verdict"];
	readonly nodes: readonly {
		readonly id: string;
		readonly dependsOn: readonly string[];
		readonly status: RunExplanation["tasks"][number]["status"];
		readonly attempt: number;
		readonly generation: number | null;
		readonly ready: boolean;
	}[];
	readonly edges: readonly { readonly source: string; readonly target: string; readonly kind: "dependency" }[];
}

/** Bracket the run/evidence read so proof and authority binding use the same committed authority view. */
export function readRunGraph(stateRoot: string, runId: string): RunGraphSnapshot {
	const authority = inspectRunAuthority(stateRoot);
	const explanation = readRunExplanation(stateRunPath(stateRoot, runId), runId, authority.status);
	if (authority.records.at(-1)?.hash !== inspectRunAuthority(stateRoot).records.at(-1)?.hash)
		throw new VerifiedRunConcurrentChangeError();
	return projectRunGraph(explanation, authority);
}

/** Trusted callers must supply the same authority view that produced the explanation. */
export function projectRunGraph(explanation: RunExplanation, authority: AuthorityStoreView): RunGraphSnapshot {
	const authorityHead = authority.records.at(-1);
	const nodes = Object.freeze(
		explanation.tasks.map((task) =>
			Object.freeze({
				id: task.taskId,
				dependsOn: Object.freeze([...task.dependsOn]),
				status: task.status,
				attempt: task.attempt,
				generation: task.generation,
				ready: task.ready,
			}),
		),
	);
	return Object.freeze({
		schemaVersion: RUN_GRAPH_VERSION,
		runtime: "node",
		graphKind: "verified-run",
		executionRequested: false,
		capabilities: Object.freeze({ execute: false, amendGraph: false }),
		runId: explanation.runId,
		cursor: Object.freeze({
			revision: explanation.revision,
			generation: explanation.generation,
			authorityRevision: authorityHead?.seq ?? 0,
			authorityDigest: authorityHead?.hash ?? GENESIS_PREVIOUS,
			...explanation.binding,
		}),
		state: Object.freeze({
			execution: explanation.status.execution,
			settlement: explanation.status.settlement,
			verification: explanation.status.verification,
			application: explanation.status.application,
			publication: explanation.status.publication.state,
		}),
		proofVerdict: explanation.proof.verdict,
		nodes,
		edges: Object.freeze(
			nodes.flatMap((node) =>
				node.dependsOn.map((source) => Object.freeze({ source, target: node.id, kind: "dependency" as const })),
			),
		),
	});
}
