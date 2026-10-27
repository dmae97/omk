/**
 * Spec 110: omk `--mode json` events + run-log lines -> one ATIF Trajectory object.
 * Pure function (no fs, no env). Every input field lands either in an ATIF slot or under
 * an `omk` key in the nearest `extra`; `reverse.mjs` proves it (round-trip test).
 * `agent.tool_definitions` reflects seq 1 only; later tool-list/system changes appear only in
 * `extra.omk.sessionInfoChanges[]` and per-step `extra.omk.sessionInfo`; no mid-run system steps are inserted.
 */
import { flattenContent, joinPieces, omit } from "./content.mjs";

export const SCHEMA_VERSION = "ATIF-v1.8";
export const EXPORTER_VERSION = "1";
export const LLM_CALL = "llm-call";
const LLM_MAPPED = ["input", "output", "cacheRead", "costTotal"];

const iso = (ms) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined);
const isWorker = (line) => line && line.role === "worker";

/** Assistant content -> ATIF agent-step fields + exact block layout. */
function mapAssistant(message) {
	const texts = [];
	const thinking = [];
	const toolCalls = [];
	const blocks = (Array.isArray(message.content) ? message.content : []).map((b) => {
		if (b?.type === "text" && typeof b.text === "string") {
			texts.push(b.text);
			return { ...omit(b, ["text"]), _slot: "text" };
		}
		if (b?.type === "thinking" && typeof b.thinking === "string") {
			thinking.push(b.thinking);
			return { ...omit(b, ["thinking"]), _slot: "thinking" };
		}
		if (b?.type === "toolCall" && typeof b.id === "string" && b.arguments && typeof b.arguments === "object" && !Array.isArray(b.arguments)) {
			toolCalls.push({ tool_call_id: b.id, function_name: b.name, arguments: b.arguments });
			return { ...omit(b, ["id", "name", "arguments"]), _slot: "toolCall" };
		}
		return b;
	});
	const msg = joinPieces(texts);
	const reasoning = joinPieces(thinking);
	return { msg, reasoning, toolCalls, blocks };
}

function metricsFrom(line) {
	const n = (v) => (typeof v === "number" ? v : 0);
	const metrics = {
		prompt_tokens: n(line.input) + n(line.cacheRead) + n(line.cacheWrite), // Q4
		completion_tokens: n(line.output),
		cached_tokens: n(line.cacheRead),
	};
	if (typeof line.costTotal === "number") metrics.cost_usd = line.costTotal;
	const rest = omit(line, LLM_MAPPED);
	// Record which mapped fields were absent/non-numeric so reversal is exact.
	const raw = {};
	for (const k of LLM_MAPPED) if (typeof line[k] !== "number") raw[k] = k in line ? line[k] : { _absent: true };
	metrics.extra = { omk: { ...rest, ...(Object.keys(raw).length ? { _raw: raw } : {}) } };
	return metrics;
}

/**
 * @param {{ events: object[], runLog: Record<string, object[]>, agentVersion: string,
 *   inputHashes?: object }} input
 */
export function buildTrajectory({ events, runLog, agentVersion, inputHashes = {} }) {
	const steps = [];
	const eventLog = []; // one entry per input event, in order
	let header;
	let sessionInfo;
	let activeInfo; // latest omk_session_info seen so far (seq 1 or a later change)
	const sessionInfoChanges = []; // spec 112 seq >= 2 lines, verbatim (masked later)
	const agentSteps = [];
	const llmLines = (runLog[LLM_CALL] ?? []).map((line, index) => ({ line, index }));
	const leadLines = llmLines.filter((l) => !isWorker(l.line));
	const firstLead = leadLines[0]?.line;

	const pushStep = (step) => {
		step.step_id = steps.length + 1;
		steps.push(step);
		return step;
	};

	events.forEach((ev, i) => {
		if (i === 0 && ev?.type === "session") {
			header = ev;
			eventLog.push({ ref: "header" });
			return;
		}
		if (ev?.type === "omk_session_info" && !sessionInfo) {
			sessionInfo = ev;
			activeInfo = ev;
			eventLog.push({ ref: "sessionInfo" });
			return;
		}
		if (ev?.type === "omk_session_info") {
			// Spec 110 follow-up: a re-emitted line (system prompt / tools changed). ATIF has no
			// slot for a mid-run system prompt change, so keep it under extra.omk and tag the
			// agent steps that ran under it (below).
			activeInfo = ev;
			sessionInfoChanges.push(ev);
			eventLog.push({ ref: "sessionInfoChange", index: sessionInfoChanges.length - 1 });
			return;
		}
		const m = ev?.type === "message_end" ? ev.message : undefined;
		if (m?.role === "user") {
			const { text, layout } = flattenContent(m.content);
			const step = pushStep({ source: "user", message: text });
			if (iso(m.timestamp)) step.timestamp = iso(m.timestamp);
			step.extra = { omk: { event: omit(ev, ["message"]), message: omit(m, ["content"]), layout } };
			eventLog.push({ ref: "step", step: step.step_id });
			return;
		}
		if (m?.role === "assistant") {
			const { msg, reasoning, toolCalls, blocks } = mapAssistant(m);
			const step = pushStep({ source: "agent", message: msg.text });
			if (iso(m.timestamp)) step.timestamp = iso(m.timestamp);
			if (typeof m.model === "string") step.model_name = m.model;
			if (reasoning.lengths.length) step.reasoning_content = reasoning.text;
			if (toolCalls.length) step.tool_calls = toolCalls;
			step.extra = {
				omk: {
					event: omit(ev, ["message"]),
					message: omit(m, ["content"]),
					blocks,
					textLengths: msg.lengths,
					thinkingLengths: reasoning.lengths,
				},
			};
			if (activeInfo) step._activeInfo = activeInfo;
			agentSteps.push(step);
			eventLog.push({ ref: "step", step: step.step_id });
			return;
		}
		if (ev?.type === "tool_execution_start") {
			const owner = [...agentSteps].reverse().find((s) => s.tool_calls?.some((c) => c.tool_call_id === ev.toolCallId));
			const call = owner?.tool_calls.find((c) => c.tool_call_id === ev.toolCallId);
			if (call && call.function_name === ev.toolName && JSON.stringify(call.arguments) === JSON.stringify(ev.args)) {
				eventLog.push({ ref: "toolStart", step: owner.step_id, id: ev.toolCallId, extra: omit(ev, ["type", "toolCallId", "toolName", "args"]) });
				return;
			}
		}
		if (ev?.type === "tool_execution_end") {
			const owner = [...agentSteps].reverse().find((s) => s.tool_calls?.some((c) => c.tool_call_id === ev.toolCallId));
			if (owner) {
				const result = ev.result && typeof ev.result === "object" && !Array.isArray(ev.result) ? ev.result : undefined;
				const flat = result ? flattenContent(result.content) : { text: "", layout: { kind: "raw", value: ev.result } };
				owner.observation ??= { results: [] };
				owner.observation.results.push({
					source_call_id: ev.toolCallId,
					content: flat.text,
					extra: {
						omk: {
							isError: ev.isError,
							toolName: ev.toolName,
							event: omit(ev, ["type", "toolCallId", "toolName", "result", "isError"]),
							result: result ? omit(result, ["content"]) : undefined,
							hasResultObject: Boolean(result),
							layout: flat.layout,
						},
					},
				});
				eventLog.push({ ref: "toolEnd", step: owner.step_id, index: owner.observation.results.length - 1 });
				return;
			}
		}
		eventLog.push({ raw: ev }); // lossless catch-all (message_update, turn_*, provider events, ...)
	});

	// System step (Q1): full text if the stream carries it, else hash placeholder.
	const systemStep = { source: "system" };
	if (typeof sessionInfo?.systemPrompt === "string") {
		systemStep.message = sessionInfo.systemPrompt;
		systemStep.extra = { omk: { systemPrompt: { placeholder: false } } };
	} else {
		const hash = firstLead?.systemHash ?? null;
		systemStep.message = `[omk: system prompt not present in event stream; systemHash=${hash ?? "unknown"}]`;
		systemStep.extra = {
			omk: { systemPrompt: { placeholder: true, systemHash: hash, reason: "json mode emits no system prompt (spec 110 Q1/Q3)" } },
		};
	}
	steps.unshift(systemStep);
	steps.forEach((s, idx) => {
		s.step_id = idx + 1;
	});
	for (const e of eventLog) if (e.step) e.step += 1;

	// Q5 join: responseId first, else order.
	const unmatched = new Set(leadLines);
	const byResponse = new Map();
	for (const l of leadLines) if (l.line.responseId) byResponse.set(l.line.responseId, l);
	const assign = (step, l) => {
		unmatched.delete(l);
		step.metrics = metricsFrom(l.line);
		step.metrics.extra.omk._line = l.index;
		step.llm_call_count = 1;
	};
	for (const step of agentSteps) {
		const rid = step.extra.omk.message.responseId;
		const l = rid ? byResponse.get(rid) : undefined;
		if (l && unmatched.has(l)) assign(step, l);
	}
	for (const step of agentSteps) {
		if (step.metrics) continue;
		const next = leadLines.find((l) => unmatched.has(l) && !l.line.responseId);
		if (next) assign(step, next);
	}

	// Tag agent steps with the session info they ran under, only when the run had a change,
	// so runs without seq >= 2 lines export byte-identically to before.
	for (const step of agentSteps) {
		const info = step._activeInfo;
		delete step._activeInfo;
		if (sessionInfoChanges.length && info) {
			step.extra.omk.sessionInfo = { seq: info.seq ?? null, systemHash: info.systemHash ?? null, toolsHash: info.toolsHash ?? null };
		}
	}

	const sum = (key) => agentSteps.reduce((acc, s) => acc + (s.metrics?.[key] ?? 0), 0);
	const modelName = firstLead?.model ?? agentSteps.find((s) => s.model_name)?.model_name;
	const agent = { name: "omk", version: agentVersion };
	if (modelName) agent.model_name = modelName;
	if (Array.isArray(sessionInfo?.tools)) {
		agent.tool_definitions = sessionInfo.tools.map((t) => ({
			type: "function",
			function: { name: t.name, description: t.description, parameters: t.parameters },
		}));
	}

	const otherRunLog = {};
	for (const [name, lines] of Object.entries(runLog)) if (name !== LLM_CALL) otherRunLog[name] = lines;

	const trajectory = {
		schema_version: SCHEMA_VERSION,
		session_id: header?.id ?? "omk-unknown-session",
		agent,
		steps,
		final_metrics: {
			total_prompt_tokens: sum("prompt_tokens"),
			total_completion_tokens: sum("completion_tokens"),
			total_cached_tokens: sum("cached_tokens"),
			total_cost_usd: sum("cost_usd"),
			total_steps: steps.length,
		},
		extra: {
			omk: {
				export: { exporterVersion: EXPORTER_VERSION, inputHashes },
				header: header ?? null,
				sessionInfo: sessionInfo
					? omit(sessionInfo, typeof sessionInfo.systemPrompt === "string" ? ["systemPrompt", "tools"] : ["tools"])
					: null,
				sessionInfoTools: sessionInfo && "tools" in sessionInfo ? sessionInfo.tools : undefined,
				...(sessionInfoChanges.length ? { sessionInfoChanges } : {}),
				eventLog,
				hasLlmCallLog: LLM_CALL in runLog,
				unmatchedLlmCalls: [...unmatched].map((l) => ({ line: l.index, record: l.line })),
				workerLlmCalls: llmLines.filter((l) => isWorker(l.line)).map((l) => ({ line: l.index, record: l.line })),
				runLog: otherRunLog,
			},
		},
	};
	return trajectory;
}
