import { type Api, type Context, getApiProvider, type Model, type SimpleStreamOptions } from "omk-ai";
import { OMK_MODEL_TABLE, OMK_PROVIDER_ID } from "./models.ts";

/** API id of the OMK provider's own stream path; it delegates to the built-in `openai-completions` implementation. */
export const OMK_API = "omk-completions";
const BACKING_API = "openai-completions";

/**
 * For a model whose table entry names a `noReasoningRoute`, the same model as that entry describes (id, thinking
 * support, limits, compat), so a call without a reasoning level goes out as e.g. `coder` with no `thinking` field.
 */
function routedModel(model: Model<Api>): Model<Api> {
	if (model.provider !== OMK_PROVIDER_ID) return model;
	const route = OMK_MODEL_TABLE.find((entry) => entry.id === model.id)?.noReasoningRoute;
	const target = route === undefined ? undefined : OMK_MODEL_TABLE.find((entry) => entry.id === route);
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
 * Stream path for OMK models. With a reasoning level the request goes out unchanged (the built-in clamps `off` and
 * `minimal` up to `low` and `max` down to `high` via the model's level map, so thinking is always enabled). Without
 * one, internal calls are re-addressed to the fallback model, because `OMK/reasoner` with `thinking: disabled` is
 * rejected by the gateway (400 `thinking_required`).
 */
export function omkStreamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
	return streamBacking(options?.reasoning ? model : routedModel(model), context, options);
}

function streamBacking(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
	const backing = getApiProvider(BACKING_API);
	if (!backing) throw new Error(`OMK provider: built-in ${BACKING_API} API is not registered.`);
	return backing.streamSimple({ ...model, api: BACKING_API } as Model<Api>, context, options);
}
