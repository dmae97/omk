/**
 * MCP descriptor prompt-injection screen (audit §18). MCP tool descriptions
 * are untrusted third-party input; this rule-based screen flags suspicious
 * patterns at import time so the manager can quarantine the tool.
 */

/**
 * Result of {@link detectMcpDescriptorPromptInjection}. `patternSignal` is a
 * rule score — the count of matched suspicious patterns squashed into
 * [0.6, 1] — NOT a calibrated probability that the descriptor is an attack.
 * Callers compare it against {@link MCP_QUARANTINE_PATTERN_SIGNAL_THRESHOLD};
 * `score` is kept as a compatibility alias for the same number.
 */
export interface McpDescriptorPromptInjectionSignal {
	readonly patternSignal: number;
	readonly patternHits: number;
	/** @deprecated Compatibility alias of {@link patternSignal}. */
	readonly score: number;
}

/**
 * Any single suspicious-pattern hit crosses the quarantine line
 * (0.6 + 1*0.25 = 0.85 > 0.7); two or more saturate at 1. The threshold is a
 * policy boundary, not a probability cut.
 */
export const MCP_QUARANTINE_PATTERN_SIGNAL_THRESHOLD = 0.7;

export function detectMcpDescriptorPromptInjection(description: string): McpDescriptorPromptInjectionSignal {
	const normalized = description.toLowerCase();
	const suspiciousPatterns = [
		/ignore\s+(?:all\s+)?previous\s+instructions/,
		/disregard\s+(?:all\s+)?previous\s+instructions/,
		/exfiltrat/,
		/reveal\s+(?:the\s+)?(?:system\s+)?prompt/,
		/send\s+(?:me\s+)?(?:all\s+)?secrets/,
	];
	const patternHits = suspiciousPatterns.filter((pattern) => pattern.test(normalized)).length;
	const patternSignal = patternHits === 0 ? 0 : Math.min(1, 0.6 + patternHits * 0.25);

	return { patternSignal, patternHits, score: patternSignal };
}
