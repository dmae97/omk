import { type Api, type Context, getApiProvider, type Model, type SimpleStreamOptions } from "omk-ai";
import { OMK_MODEL_TABLE, OMK_PROVIDER_ID } from "./models.ts";

/** API id of the OMK provider's own stream path; it delegates to the built-in `openai-completions` implementation. */
export const OMK_API = "omk-completions";
const BACKING_API = "openai-completions";

function routeOf(model: Model<Api>): string | undefined {
	if (model.provider !== OMK_PROVIDER_ID) return undefined;
	return OMK_MODEL_TABLE.find((entry) => entry.id === model.id)?.noReasoningRoute;
}

/**
 * The model that the table entry's `noReasoningRoute` names (id, thinking support, limits, compat), so a call without
 * a reasoning level goes out as e.g. `coder` with no `thinking` field.
 */
function routedModel(model: Model<Api>, route: string): Model<Api> {
	const target = OMK_MODEL_TABLE.find((entry) => entry.id === route);
	if (!target) return model;
	return {
		...model,
		id: target.id,
		name: target.name ?? target.id,
		reasoning: target.reasoning ?? false,
		thinkingLevelMap: target.thinkingLevelMap,
		input: target.input ?? ["text"],
		cost: target.cost ?? model.cost,
		contextWindow: target.contextWindow ?? model.contextWindow,
		maxTokens: target.maxTokens ?? model.maxTokens,
		compat: target.compat ?? model.compat,
	} as Model<Api>;
}

/**
 * Stream path for OMK models. `OMK/reasoner` with `thinking: disabled` is rejected by the gateway (400
 * `thinking_required`), and a user turn must never be swapped to another model, so:
 * - with a reasoning level: unchanged (the built-in clamps `off`/`minimal` up to `low` and `max` down to `high`);
 * - an agent turn whose state is `off` (the agent loop always carries the `reasoning` key, `undefined` when off, even
 *   on paths that skip the session's clamp): sent as `reasoning: "minimal"`, which is not in the level map and clamps up to `low`;
 * - an internal call (no `reasoning` key at all, e.g. branch summaries): re-addressed to the fallback model.
 * If the key were ever dropped from a user turn it would land in the last case; the session-path tests pin it.
 */
export function omkStreamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
	const route = routeOf(model);
	if (route === undefined || options?.reasoning) return streamBacking(model, context, options);
	if (options && "reasoning" in options) return streamBacking(model, context, { ...options, reasoning: "minimal" });
	return streamBacking(routedModel(model, route), context, options);
}

function streamBacking(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
	const backing = getApiProvider(BACKING_API);
	if (!backing) throw new Error(`OMK provider: built-in ${BACKING_API} API is not registered.`);
	return backing.streamSimple({ ...model, api: BACKING_API } as Model<Api>, context, options);
}
