/** The complete next request, not a title followed by host-generated checklist text. */
export const MAX_SUGGESTION_PROSE_CHARS = 1200;

const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });

export function suggestionSentences(text: string): string[] {
	return Array.from(segmenter.segment(text), ({ segment }) => segment.trim()).filter(Boolean);
}

export function isSuggestionProse(text: string): boolean {
	if (text.length > MAX_SUGGESTION_PROSE_CHARS || /(?:^|\n)\s*(?:[#`<[{]|[-*]\s|\d+[.)]\s)/u.test(text)) return false;
	const sentences = suggestionSentences(text);
	return (
		sentences.length >= 3 && sentences.length <= 5 && sentences.every((sentence) => /[.!?。！？]$/.test(sentence))
	);
}
