import type { ElementSummary, Observation, ObservationSnapshot, ObservationSnapshotQuality } from "./types.ts";

const FULL_ELEMENT_COVERAGE_COUNT = 5;

export function createObservationSnapshot(
	observation: Observation,
	previous?: ObservationSnapshot,
): ObservationSnapshot {
	const url = normalizeWhitespace(observation.url);
	const title = observation.title === undefined ? undefined : normalizeWhitespace(observation.title);
	const text = observation.text === undefined ? "" : normalizeWhitespace(observation.text);
	const elements = summarizeElements(observation);
	const fingerprint = stableHash(
		stableStringify({
			url,
			title: title ?? "",
			text,
			elements: elements.map((element) => ({ selector: element.selector, value: element.value })),
		}),
	);

	return {
		id: `obs_${fingerprint.slice(0, 16)}`,
		fingerprint,
		url,
		...(title !== undefined ? { title } : {}),
		textDigest: stableHash(text),
		textLength: observation.text?.length ?? 0,
		elements,
		quality: createQuality(url, title, text, elements, fingerprint, previous),
	};
}

function summarizeElements(observation: Observation): readonly ElementSummary[] {
	return [...(observation.dom ?? [])]
		.map((element) => ({
			selector: normalizeWhitespace(element.selector),
			value: normalizeWhitespace(element.value),
		}))
		.sort((left, right) => {
			const selectorOrder = left.selector.localeCompare(right.selector);
			if (selectorOrder !== 0) {
				return selectorOrder;
			}
			return left.value.localeCompare(right.value);
		})
		.map((element) => ({
			selector: element.selector,
			value: element.value,
			fingerprint: `el_${stableHash(`${element.selector}\u0000${element.value}`).slice(0, 16)}`,
		}));
}

function createQuality(
	url: string,
	title: string | undefined,
	text: string,
	elements: readonly ElementSummary[],
	fingerprint: string,
	previous: ObservationSnapshot | undefined,
): ObservationSnapshotQuality {
	const evidenceCount = [url.length > 0, (title ?? "").length > 0, text.length > 0, elements.length > 0].filter(
		Boolean,
	).length;

	return {
		parse: urlParseQuality(url),
		freshness: previous === undefined || previous.fingerprint !== fingerprint ? 1 : 0,
		elementCoverage: clamp01(elements.length / FULL_ELEMENT_COVERAGE_COUNT),
		evidenceCoverage: clamp01(evidenceCount / 4),
	};
}

function urlParseQuality(url: string): number {
	if (url.length === 0) {
		return 0;
	}
	try {
		new URL(url);
		return 1;
	} catch {
		return 0.5;
	}
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) ?? "undefined";
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}

	const record = value as Readonly<Record<string, unknown>>;
	const entries = Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
	return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/gu, " ");
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}

function stableHash(value: string): string {
	return `${stableHashPart(value, 0x811c9dc5)}${stableHashPart(value, 0x45d9f3b)}`;
}

function stableHashPart(value: string, seed: number): string {
	let hash = seed;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}
