import type { Api, Model } from "omk-ai";

const IMAGINE_MODEL_ID_PREFIX = "grok-imagine-";
/** Preferred chat fallbacks when session model is Imagine-only (first match wins). */
const COMPACTION_PREFERRED_CHAT_IDS = ["grok-4.5", "grok-4.3"] as const;
const COMPACTION_FALLBACK_MODEL_ID = COMPACTION_PREFERRED_CHAT_IDS[0];

function isChatCompactionCandidate(model: Model<Api>): boolean {
	return !model.id.startsWith(IMAGINE_MODEL_ID_PREFIX);
}

function preferredChatRank(modelId: string): number {
	const index = COMPACTION_PREFERRED_CHAT_IDS.indexOf(modelId as (typeof COMPACTION_PREFERRED_CHAT_IDS)[number]);
	return index === -1 ? COMPACTION_PREFERRED_CHAT_IDS.length : index;
}

/** True when the model id is a Grok image/generation model (not suitable for compaction chat). */
export function isImagineOrGenerationModel(model: Model<any>): boolean {
	return model.id.startsWith(IMAGINE_MODEL_ID_PREFIX);
}

/**
 * Model used for compaction summarization. Imagine/generation models fall back to a chat model
 * on the same provider (prefer grok-4.5, then grok-4.3, then any other non-imagine registry chat).
 */
export function resolveCompactionModel(sessionModel: Model<any>, availableModels?: readonly Model<Api>[]): Model<any> {
	if (!isImagineOrGenerationModel(sessionModel)) {
		return sessionModel;
	}
	if (availableModels) {
		const sameProviderChat = availableModels
			.filter((m) => m.provider === sessionModel.provider && isChatCompactionCandidate(m))
			.sort((a, b) => preferredChatRank(a.id) - preferredChatRank(b.id));
		if (sameProviderChat[0]) {
			return sameProviderChat[0];
		}
	}
	return {
		...sessionModel,
		id: COMPACTION_FALLBACK_MODEL_ID,
	};
}
