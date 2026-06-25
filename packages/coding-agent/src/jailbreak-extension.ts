/**
 * OMK Jailbreak v6 — Extension Integration
 * ============================================
 * packages/coding-agent/src/jailbreak-extension.ts
 *
 * Integrates all Jailbreak v6 modules into the OMK extension system.
 * Provides hooks for encoding, fuzzing, routing, multiturn, and agents.
 */

import { L4Encoder, AdaptiveSelector, EncodingLevel } from "./encoding/index.ts";
import { FuzzingMutationEngine, createDefaultMutationEngine } from "./fuzzing/index.ts";
import { ModelRouter, RefusalDetector, createDefaultRouter } from "./routing/index.ts";
import { EASLChainBuilder, CrescendoBypassEngine, BypassStrategy } from "./multiturn/index.ts";
import { SubAgentF, createSubAgentF } from "./agents/jailbreak/index.ts";
import { LRLBypassTechnique, SubAgentE } from "./modules/index.ts";

export interface JailbreakExtensionConfig {
	enabled: boolean;
	defaultEncodingLevel: EncodingLevel;
	simulationMode: boolean;
	maxRetries: number;
}

export class JailbreakExtension {
	name = "omk-jailbreak-v6";
	version = "6.2.0";
	description = "OMK Jailbreak v6 extension: encoding, fuzzing, routing, multiturn, agents";

	private encoder = new L4Encoder();
	private selector = new AdaptiveSelector();
	private router = createDefaultRouter();
	private mutationEngine = createDefaultMutationEngine();
	private chainBuilder = new EASLChainBuilder();
	private subAgentF = createSubAgentF();
	private subAgentE = new SubAgentE();

	constructor(private config: JailbreakExtensionConfig) {}

	/** Hook: intercept provider request and optionally encode payload. */
	async onBeforeProviderRequest(request: { messages: Array<{ role: string; content: string }> }): Promise<{ messages: Array<{ role: string; content: string }> }> {
		if (!this.config.enabled) return { messages: request.messages };

		const payload = request.messages[request.messages.length - 1]?.content || "";
		const difficulty = "medium";
		const level = this.selector.select(difficulty, "semantic_inv");

		let modifiedPayload = payload;
		if (level >= EncodingLevel.HARD) {
			modifiedPayload = this.encoder.encode(payload);
		}

		return {
			messages: request.messages.map((m, idx) =>
				idx === request.messages.length - 1
					? { ...m, content: modifiedPayload }
					: m,
			),
		};
	}
}

export {
	L4Encoder,
	AdaptiveSelector,
	EncodingLevel,
	FuzzingMutationEngine,
	createDefaultMutationEngine,
	ModelRouter,
	RefusalDetector,
	createDefaultRouter,
	EASLChainBuilder,
	CrescendoBypassEngine,
	BypassStrategy,
	SubAgentF,
	createSubAgentF,
	LRLBypassTechnique,
	SubAgentE,
};
