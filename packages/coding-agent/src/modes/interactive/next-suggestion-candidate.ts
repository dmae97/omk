import type { AssistantMessage } from "omk-ai";
import type { RecordedMainRequest } from "../../core/next-suggestion.ts";

const CANDIDATE_TTL_MS = 120_000;

interface Candidate {
	readonly record: RecordedMainRequest;
	readonly finalAssistant: AssistantMessage;
	readonly provider: string;
	readonly model: string;
	readonly text: string;
	readonly createdAtMs: number;
	dismissed: boolean;
}

/** One memory-only candidate; object identity avoids hashing or persisting raw prompts. */
export class NextSuggestionCandidate {
	private candidate: Candidate | undefined;
	private readonly now: () => number;

	constructor(now: () => number = Date.now) {
		this.now = now;
	}

	get(
		record: RecordedMainRequest | undefined,
		finalAssistant: AssistantMessage | undefined,
		model: { readonly provider: string; readonly id: string } | undefined,
	): string | undefined {
		const candidate = this.candidate;
		if (!candidate) return undefined;
		if (
			candidate.dismissed ||
			candidate.record !== record ||
			candidate.finalAssistant !== finalAssistant ||
			candidate.provider !== model?.provider ||
			candidate.model !== model.id ||
			this.now() - candidate.createdAtMs >= CANDIDATE_TTL_MS
		) {
			this.candidate = undefined;
			return undefined;
		}
		return candidate.text;
	}

	store(record: RecordedMainRequest, finalAssistant: AssistantMessage, text: string): void {
		this.candidate = {
			record,
			finalAssistant,
			provider: record.model.provider,
			model: record.model.id,
			text,
			createdAtMs: this.now(),
			dismissed: false,
		};
	}

	dismiss(text: string): void {
		if (this.candidate?.text === text) this.candidate.dismissed = true;
	}

	clear(): void {
		this.candidate = undefined;
	}
}
