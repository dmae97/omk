/**
 * In-memory AdaptOrch transport for tests and local evaluation fixtures.
 */

import { AdaptOrchClient, type AdaptOrchTransport } from "./adaptorch-client.ts";

export type InMemoryAdaptOrchFixture = Record<string, { run: unknown; artifacts: unknown; traces: unknown }>;

function makeFakeTransport(byRunId: InMemoryAdaptOrchFixture): AdaptOrchTransport {
	return {
		async callTool(name: string, args: Record<string, unknown>) {
			const runId = args.run_id as string;
			const fixture = byRunId[runId];
			if (!fixture) throw new Error(`no fixture for run_id ${runId}`);
			if (name === "adaptorch_get_run") return fixture.run;
			if (name === "adaptorch_get_artifacts") return fixture.artifacts;
			if (name === "adaptorch_get_traces") return fixture.traces;
			throw new Error(`unexpected tool call: ${name}`);
		},
	};
}

/** Build an {@link AdaptOrchClient} backed by a per-run_id fixture map. */
export function createInMemoryAdaptOrchClient(fixture: InMemoryAdaptOrchFixture): AdaptOrchClient {
	return new AdaptOrchClient(makeFakeTransport(fixture));
}
