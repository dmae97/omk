/**
 * Spec 110 success criterion 1: ATIF Trajectory -> original omk events + run-log lines.
 * Used only by tests to prove the export loses no field.
 */
import { restoreContent, splitPieces } from "./content.mjs";
import { LLM_CALL } from "./map.mjs";

const LLM_MAPPED = ["input", "output", "cacheRead", "costTotal"];

function llmLineFrom(metrics) {
	const { _line, _raw = {}, ...rest } = metrics.extra.omk;
	const line = { ...rest };
	const derived = {
		input: metrics.prompt_tokens - metrics.cached_tokens - (typeof rest.cacheWrite === "number" ? rest.cacheWrite : 0),
		output: metrics.completion_tokens,
		cacheRead: metrics.cached_tokens,
		costTotal: metrics.cost_usd,
	};
	for (const k of LLM_MAPPED) {
		if (k in _raw) {
			if (!(_raw[k] && _raw[k]._absent)) line[k] = _raw[k];
		} else line[k] = derived[k];
	}
	return { index: _line, line };
}

function restoreAssistant(step) {
	const o = step.extra.omk;
	const texts = splitPieces(step.message, o.textLengths);
	const thinking = splitPieces(step.reasoning_content ?? "", o.thinkingLengths);
	const calls = [...(step.tool_calls ?? [])];
	let ti = 0;
	let hi = 0;
	const content = o.blocks.map((b) => {
		if (!b || !b._slot) return b;
		const { _slot, ...rest } = b;
		if (_slot === "text") return { ...rest, text: texts[ti++] };
		if (_slot === "thinking") return { ...rest, thinking: thinking[hi++] };
		const c = calls.shift();
		return { ...rest, id: c.tool_call_id, name: c.function_name, arguments: c.arguments };
	});
	return { ...o.event, message: { ...o.message, content } };
}

export function reverseTrajectory(t) {
	const omk = t.extra.omk;
	const stepById = new Map(t.steps.map((s) => [s.step_id, s]));
	const events = omk.eventLog.map((e) => {
		if (e.raw !== undefined || "raw" in e) return e.raw;
		if (e.ref === "header") return omk.header;
		if (e.ref === "sessionInfo") {
			const info = { ...omk.sessionInfo };
			if (!("systemPrompt" in info)) {
				const sys = t.steps.find((s) => s.source === "system");
				if (sys && !sys.extra.omk.systemPrompt.placeholder) info.systemPrompt = sys.message;
			}
			if (omk.sessionInfoTools !== undefined) info.tools = omk.sessionInfoTools;
			return info;
		}
		if (e.ref === "sessionInfoChange") return omk.sessionInfoChanges[e.index];
		const step = stepById.get(e.step);
		if (e.ref === "step" && step.source === "user") {
			const o = step.extra.omk;
			return { ...o.event, message: { ...o.message, content: restoreContent(step.message, o.layout) } };
		}
		if (e.ref === "step") return restoreAssistant(step);
		if (e.ref === "toolStart") {
			const c = step.tool_calls.find((x) => x.tool_call_id === e.id);
			return { type: "tool_execution_start", toolCallId: c.tool_call_id, toolName: c.function_name, args: c.arguments, ...e.extra };
		}
		if (e.ref === "toolEnd") {
			const r = step.observation.results[e.index];
			const o = r.extra.omk;
			const content = restoreContent(r.content, o.layout);
			const result = o.hasResultObject ? { ...o.result, content } : content;
			return { type: "tool_execution_end", toolCallId: r.source_call_id, toolName: o.toolName, result, isError: o.isError, ...o.event };
		}
		throw new Error(`unknown eventLog entry ${JSON.stringify(e)}`);
	});

	const runLog = { ...omk.runLog };
	if (omk.hasLlmCallLog) {
		const lines = [];
		for (const s of t.steps) if (s.metrics) lines.push(llmLineFrom(s.metrics));
		for (const u of omk.unmatchedLlmCalls) lines.push({ index: u.line, line: u.record });
		for (const w of omk.workerLlmCalls) lines.push({ index: w.line, line: w.record });
		lines.sort((a, b) => a.index - b.index);
		runLog[LLM_CALL] = lines.map((l) => l.line);
	}
	return { events, runLog };
}
