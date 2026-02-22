import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { type Static, Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import pollJobsDescription from "../prompts/tools/poll-jobs.md" with { type: "text" };
import type { ToolSession } from "./index";

const pollJobsSchema = Type.Object({
	job_ids: Type.Optional(
		Type.Array(Type.String(), {
			description: "Specific job IDs to wait for. If omitted, waits for any running job.",
		}),
	),
	timeout: Type.Optional(
		Type.Number({
			description: "Maximum seconds to wait before returning (default: 300)",
		}),
	),
});

type PollJobsParams = Static<typeof pollJobsSchema>;

interface PollJobResult {
	id: string;
	type: "bash" | "task";
	status: "running" | "completed" | "failed" | "cancelled";
	label: string;
	durationMs: number;
	resultText?: string;
	errorText?: string;
}

export interface PollJobsToolDetails {
	jobs: PollJobResult[];
	timedOut: boolean;
}

export class PollJobsTool implements AgentTool<typeof pollJobsSchema, PollJobsToolDetails> {
	readonly name = "poll_jobs";
	readonly label = "PollJobs";
	readonly description: string;
	readonly parameters = pollJobsSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {
		this.description = renderPromptTemplate(pollJobsDescription);
	}

	static createIf(session: ToolSession): PollJobsTool | null {
		if (!session.settings.get("async.enabled")) return null;
		return new PollJobsTool(session);
	}

	async execute(
		_toolCallId: string,
		params: PollJobsParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<PollJobsToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<PollJobsToolDetails>> {
		const manager = this.session.asyncJobManager;
		if (!manager) {
			return {
				content: [{ type: "text", text: "Async execution is disabled; no background jobs to poll." }],
				details: { jobs: [], timedOut: false },
			};
		}

		const timeoutMs = (params.timeout ?? 300) * 1000;
		const requestedIds = params.job_ids;

		// Resolve which jobs to watch
		const jobsToWatch = requestedIds?.length
			? requestedIds.map(id => manager.getJob(id)).filter(j => j != null)
			: manager.getRunningJobs();

		if (jobsToWatch.length === 0) {
			const message = requestedIds?.length
				? `No matching jobs found for IDs: ${requestedIds.join(", ")}`
				: "No running background jobs to wait for.";
			return {
				content: [{ type: "text", text: message }],
				details: { jobs: [], timedOut: false },
			};
		}

		// If all watched jobs are already done, return immediately
		const runningJobs = jobsToWatch.filter(j => j.status === "running");
		if (runningJobs.length === 0) {
			return this.#buildResult(jobsToWatch, false);
		}

		// Block until at least one running job finishes or timeout
		const racePromises: Promise<unknown>[] = runningJobs.map(j => j.promise);
		racePromises.push(Bun.sleep(timeoutMs));

		if (signal) {
			const { promise: abortPromise, resolve: abortResolve } = Promise.withResolvers<void>();
			const onAbort = () => abortResolve();
			signal.addEventListener("abort", onAbort, { once: true });
			racePromises.push(abortPromise);
			try {
				await Promise.race(racePromises);
			} finally {
				signal.removeEventListener("abort", onAbort);
			}
		} else {
			await Promise.race(racePromises);
		}

		if (signal?.aborted) {
			return this.#buildResult(jobsToWatch, false);
		}

		// Check if we timed out (all watched jobs still running)
		const stillRunning = jobsToWatch.filter(j => j.status === "running");
		const timedOut = stillRunning.length === runningJobs.length;

		return this.#buildResult(jobsToWatch, timedOut);
	}

	#buildResult(
		jobs: {
			id: string;
			type: "bash" | "task";
			status: string;
			label: string;
			startTime: number;
			resultText?: string;
			errorText?: string;
		}[],
		timedOut: boolean,
	): AgentToolResult<PollJobsToolDetails> {
		const now = Date.now();
		const jobResults: PollJobResult[] = jobs.map(j => ({
			id: j.id,
			type: j.type,
			status: j.status as PollJobResult["status"],
			label: j.label,
			durationMs: Math.max(0, now - j.startTime),
			...(j.resultText ? { resultText: j.resultText } : {}),
			...(j.errorText ? { errorText: j.errorText } : {}),
		}));

		const completed = jobResults.filter(j => j.status !== "running");
		const running = jobResults.filter(j => j.status === "running");

		const lines: string[] = [];
		if (timedOut) {
			lines.push("Timed out waiting for jobs to complete.\n");
		}

		if (completed.length > 0) {
			lines.push(`## Completed (${completed.length})\n`);
			for (const j of completed) {
				lines.push(`### ${j.id} [${j.type}] — ${j.status}`);
				lines.push(`Label: ${j.label}`);
				if (j.resultText) {
					lines.push("```", j.resultText, "```");
				}
				if (j.errorText) {
					lines.push(`Error: ${j.errorText}`);
				}
				lines.push("");
			}
		}

		if (running.length > 0) {
			lines.push(`## Still Running (${running.length})\n`);
			for (const j of running) {
				lines.push(`- \`${j.id}\` [${j.type}] — ${j.label}`);
			}
		}

		return {
			content: [{ type: "text", text: lines.join("\n") }],
			details: { jobs: jobResults, timedOut },
		};
	}
}
