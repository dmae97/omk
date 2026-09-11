import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { executeRunCommand, type OwnedRunCommand } from "./owned-execution.ts";
import type { RunPhaseContext } from "./phase-context.ts";
import { executeScriptedWriter } from "./scripted-writer.ts";
import type { VerifiedRunRuntime } from "./session-port.ts";
import { VerifiedRunError } from "./storage.ts";

export async function executeWriter(
	context: RunPhaseContext,
	options: {
		readonly workspace: string;
		readonly deadline: number;
		readonly runtime?: VerifiedRunRuntime;
	},
): Promise<void> {
	const { contract, journal } = context;
	const execute = (request: OwnedRunCommand, toolSignal?: AbortSignal) => {
		const signals = [context.signal, toolSignal].filter((signal): signal is AbortSignal => signal !== undefined);
		return executeRunCommand(journal, request, {
			...contract.budget,
			...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
		});
	};
	switch (contract.profile) {
		case "linux-command-v1": {
			const writer = await execute({
				role: "writer",
				argv: contract.writer,
				workspace: options.workspace,
				deadline: options.deadline,
				claimId: null,
			});
			if (writer.result.failure) throw new VerifiedRunError(writer.result.failure);
			return;
		}
		case "linux-scripted-agent-v1": {
			const runtime = options.runtime;
			if (!runtime) throw new VerifiedRunError("writer_backend_missing");
			const writer = contract.writer;
			const requestLimit = writer.maxRequests - journal.state.modelRequests;
			if (requestLimit <= 0) throw new VerifiedRunError("model_request_limit");
			journal.append({ kind: "writer_opened" });
			let completed = false;
			try {
				await executeScriptedWriter(writer, contract.goal, {
					runtime,
					workspace: options.workspace,
					deadline: options.deadline,
					requestLimit,
					...(context.signal ? { signal: context.signal } : {}),
					beforeRequest: () => {
						if (performance.now() >= options.deadline) throw new VerifiedRunError("deadline");
						journal.append({ kind: "model_request", requestId: randomUUID() });
						if (performance.now() >= options.deadline) throw new VerifiedRunError("deadline");
					},
					executeStep: (index, signal) => {
						const argv = writer.steps[index];
						if (!argv) throw new VerifiedRunError("writer_step");
						return execute(
							{ role: "writer", argv, workspace: options.workspace, deadline: options.deadline, claimId: null },
							signal,
						);
					},
				});
				completed = true;
			} finally {
				if (journal.state.activeExecutionIds.length === 0) journal.append({ kind: "writer_closed", completed });
			}
			return;
		}
		default: {
			const exhaustive: never = contract;
			throw new VerifiedRunError(String(exhaustive));
		}
	}
}
