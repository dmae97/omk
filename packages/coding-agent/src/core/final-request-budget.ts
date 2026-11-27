export const DEFAULT_MESSAGE_WRAPPER_TOKENS = 8;
export const DEFAULT_TOOL_WRAPPER_TOKENS = 24;
export const DEFAULT_REQUEST_ENVELOPE_TOKENS = 128;

export interface FinalRequestBudgetInput {
	readonly contextWindow: number;
	readonly systemTokens: number;
	readonly messageTokens: number;
	readonly messageCount: number;
	readonly toolSchemaTokens: number;
	readonly toolCount: number;
	readonly imageTokens: number;
	readonly completionReserveTokens: number;
	readonly verificationReserveTokens: number;
	readonly wrapperTokensPerMessage?: number;
	readonly wrapperTokensPerTool?: number;
	readonly requestEnvelopeTokens?: number;
}

export interface FinalRequestBudgetDecision {
	readonly fits: boolean;
	readonly payloadTokens: number;
	readonly wrapperOverheadTokens: number;
	readonly reservedTokens: number;
	readonly totalRequiredTokens: number;
	readonly overflowTokens: number;
	readonly remainingHeadroomTokens: number;
	readonly verificationReserveProtected: boolean;
}

function nonNegInt(value: number, label: string): number {
	if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a non-negative finite number`);
	return Math.ceil(value);
}

/**
 * Evaluate context budget against the FINAL provider request:
 * system + messages + tool schemas + provider message/tool JSON wrapper overhead + images
 * + mandatory completion and verification reserves.
 */
export function evaluateFinalRequestBudget(input: FinalRequestBudgetInput): FinalRequestBudgetDecision {
	const contextWindow = nonNegInt(input.contextWindow, "contextWindow");
	const systemTokens = nonNegInt(input.systemTokens, "systemTokens");
	const messageTokens = nonNegInt(input.messageTokens, "messageTokens");
	const messageCount = nonNegInt(input.messageCount, "messageCount");
	const toolSchemaTokens = nonNegInt(input.toolSchemaTokens, "toolSchemaTokens");
	const toolCount = nonNegInt(input.toolCount, "toolCount");
	const imageTokens = nonNegInt(input.imageTokens, "imageTokens");
	const completionReserveTokens = nonNegInt(input.completionReserveTokens, "completionReserveTokens");
	const verificationReserveTokens = nonNegInt(input.verificationReserveTokens, "verificationReserveTokens");

	const perMessage = nonNegInt(
		input.wrapperTokensPerMessage ?? DEFAULT_MESSAGE_WRAPPER_TOKENS,
		"wrapperTokensPerMessage",
	);
	const perTool = nonNegInt(input.wrapperTokensPerTool ?? DEFAULT_TOOL_WRAPPER_TOKENS, "wrapperTokensPerTool");
	const envelope = nonNegInt(input.requestEnvelopeTokens ?? DEFAULT_REQUEST_ENVELOPE_TOKENS, "requestEnvelopeTokens");

	const wrapperOverheadTokens = envelope + messageCount * perMessage + toolCount * perTool;
	const payloadTokens = systemTokens + messageTokens + toolSchemaTokens + imageTokens + wrapperOverheadTokens;
	const reservedTokens = completionReserveTokens + verificationReserveTokens;
	const totalRequiredTokens = payloadTokens + reservedTokens;
	const fits = totalRequiredTokens <= contextWindow;
	const overflowTokens = fits ? 0 : totalRequiredTokens - contextWindow;
	const remainingHeadroomTokens = fits ? contextWindow - totalRequiredTokens : 0;

	return {
		fits,
		payloadTokens,
		wrapperOverheadTokens,
		reservedTokens,
		totalRequiredTokens,
		overflowTokens,
		remainingHeadroomTokens,
		verificationReserveProtected: fits && verificationReserveTokens > 0,
	};
}
