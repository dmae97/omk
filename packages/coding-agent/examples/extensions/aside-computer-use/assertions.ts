import type {
	AssertionVerification,
	AssertionVerificationStatus,
	AssertionVerificationSummary,
	Observation,
	SuccessAssertion,
	SuccessCriterion,
} from "./types.ts";

export interface VerifyAssertionsOptions {
	readonly minConfidence?: number;
	readonly allowLowConfidenceFallback?: boolean;
	readonly tokenOverlapThreshold?: number;
}

type CriterionInput = string | SuccessCriterion;

const DEFAULT_MIN_CONFIDENCE = 0.7;
const DEFAULT_TOKEN_OVERLAP_THRESHOLD = 0.6;

export function parseCriterionToAssertion(criterion: CriterionInput): SuccessAssertion {
	const source = typeof criterion === "string" ? criterion : criterion.description;
	const description = normalizeWhitespace(source);
	const id = typeof criterion === "string" ? `assert_${stableHash(description)}` : criterion.id;

	const domPrefix = "dom:";
	if (description.startsWith(domPrefix)) {
		const domCriterion = description.slice(domPrefix.length);
		const separatorIndex = domCriterion.lastIndexOf("=");
		if (separatorIndex > 0) {
			const target = normalizeWhitespace(domCriterion.slice(0, separatorIndex));
			const expected = normalizeExpected(domCriterion.slice(separatorIndex + 1));
			if (target.length > 0) {
				return createAssertion(id, description, "element_value", 0.95, { target, expected });
			}
		}
	}

	const visiblePrefix = "visible:";
	if (description.startsWith(visiblePrefix)) {
		const target = normalizeWhitespace(description.slice(visiblePrefix.length));
		if (target.length > 0) {
			return createAssertion(id, description, "element_visible", 0.95, { target });
		}
	}

	const urlPrefix = "url:";
	if (description.startsWith(urlPrefix)) {
		return createAssertion(id, description, "url", 0.8, {
			expected: normalizeExpected(description.slice(urlPrefix.length)),
		});
	}

	const titlePrefix = "title:";
	if (description.startsWith(titlePrefix)) {
		return createAssertion(id, description, "title", 0.7, {
			expected: normalizeExpected(description.slice(titlePrefix.length)),
		});
	}

	const textPrefix = "text:";
	if (description.startsWith(textPrefix)) {
		return createAssertion(id, description, "text", 0.7, {
			expected: normalizeExpected(description.slice(textPrefix.length)),
		});
	}

	const absentPrefix = "absent:";
	if (description.startsWith(absentPrefix)) {
		return createAssertion(id, description, "negative_text_absent", 0.7, {
			expected: normalizeExpected(description.slice(absentPrefix.length)),
		});
	}

	const quotedPhrase = getQuotedPhrase(description);
	if (quotedPhrase !== undefined) {
		return createAssertion(id, description, "text", 0.7, { expected: quotedPhrase });
	}

	const tokens = tokenize(description);
	return createAssertion(id, description, "token_overlap", 0.45, {
		expected: description,
		tokens,
	});
}

export function verifyAssertions(
	assertions: readonly SuccessAssertion[],
	observation: Observation,
	options: VerifyAssertionsOptions = {},
): AssertionVerificationSummary {
	const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
	const allowLowConfidenceFallback = options.allowLowConfidenceFallback ?? false;
	const results = assertions.map((assertion) => verifyAssertion(assertion, observation, options));
	const requiredResults = results.filter((result) => result.assertion.required);

	if (requiredResults.length === 0) {
		return {
			status: "inconclusive",
			confidence: 0,
			assertions: results,
		};
	}

	const confidence = Math.min(...requiredResults.map((result) => result.confidence));
	const hasFailure = requiredResults.some((result) => result.status === "fail");
	if (hasFailure) {
		return {
			status: "fail",
			confidence,
			assertions: results,
		};
	}

	const hasInconclusive = requiredResults.some((result) => result.status === "inconclusive");
	const hasLowConfidence = requiredResults.some((result) => {
		const fallbackAllowed = result.assertion.kind === "token_overlap" && allowLowConfidenceFallback;
		return result.status === "pass" && result.confidence < minConfidence && !fallbackAllowed;
	});

	return {
		status: hasInconclusive || hasLowConfidence ? "inconclusive" : "pass",
		confidence,
		assertions: results,
	};
}

function createAssertion(
	id: string,
	description: string,
	kind: SuccessAssertion["kind"],
	confidence: number,
	fields: {
		readonly target?: string;
		readonly expected?: string;
		readonly tokens?: readonly string[];
	},
): SuccessAssertion {
	return {
		id,
		kind,
		description,
		required: true,
		confidence,
		...(fields.target !== undefined ? { target: fields.target } : {}),
		...(fields.expected !== undefined ? { expected: fields.expected } : {}),
		...(fields.tokens !== undefined ? { tokens: fields.tokens } : {}),
	};
}

function verifyAssertion(
	assertion: SuccessAssertion,
	observation: Observation,
	options: VerifyAssertionsOptions,
): AssertionVerification {
	switch (assertion.kind) {
		case "element_value":
			return verifyElementValue(assertion, observation);
		case "element_visible":
			return verifyElementVisible(assertion, observation);
		case "url":
			return verifyContains(assertion, observation.url, "url");
		case "title":
			return verifyContains(assertion, observation.title ?? "", "title");
		case "text":
			return verifyContains(assertion, observation.text ?? "", "text");
		case "negative_text_absent":
			return verifyNegativeTextAbsent(assertion, observation);
		case "token_overlap":
			return verifyTokenOverlap(assertion, observation, options);
	}
}

function verifyElementValue(assertion: SuccessAssertion, observation: Observation): AssertionVerification {
	if (assertion.target === undefined || assertion.expected === undefined) {
		return inconclusive(assertion, "element value assertion is missing a selector or expected value", 0);
	}

	const element = findElement(observation, assertion.target);
	if (element === undefined) {
		return fail(assertion, `selector ${assertion.target} was not observed`, assertion.confidence);
	}

	const actual = normalizeForMatch(element.value);
	const expected = normalizeForMatch(assertion.expected);
	if (actual === expected) {
		return pass(
			assertion,
			`selector ${assertion.target} matched expected value`,
			assertion.confidence,
			element.value,
		);
	}

	return fail(assertion, `selector ${assertion.target} value did not match`, assertion.confidence, element.value);
}

function verifyElementVisible(assertion: SuccessAssertion, observation: Observation): AssertionVerification {
	if (assertion.target === undefined) {
		return inconclusive(assertion, "visible assertion is missing a selector", 0);
	}

	const element = findElement(observation, assertion.target);
	if (element === undefined) {
		return fail(assertion, `selector ${assertion.target} was not observed`, assertion.confidence);
	}

	return pass(assertion, `selector ${assertion.target} was observed`, assertion.confidence, element.value);
}

function verifyContains(assertion: SuccessAssertion, actualValue: string, label: string): AssertionVerification {
	if (assertion.expected === undefined || assertion.expected.length === 0) {
		return inconclusive(assertion, `${label} assertion is missing expected text`, 0);
	}
	if (actualValue.length === 0) {
		return inconclusive(assertion, `${label} was not present in the observation`, assertion.confidence);
	}
	if (containsNormalized(actualValue, assertion.expected)) {
		return pass(assertion, `${label} contained expected text`, assertion.confidence, actualValue);
	}
	return fail(assertion, `${label} did not contain expected text`, assertion.confidence, actualValue);
}

function verifyNegativeTextAbsent(assertion: SuccessAssertion, observation: Observation): AssertionVerification {
	if (assertion.expected === undefined || assertion.expected.length === 0) {
		return inconclusive(assertion, "negative text assertion is missing expected text", 0);
	}

	const searchableText = observationText(observation);
	if (searchableText.length === 0) {
		return inconclusive(assertion, "no textual evidence was present in the observation", assertion.confidence);
	}
	if (containsNormalized(searchableText, assertion.expected)) {
		return fail(assertion, "forbidden text was present", assertion.confidence, assertion.expected);
	}
	return pass(assertion, "forbidden text was absent", assertion.confidence);
}

function verifyTokenOverlap(
	assertion: SuccessAssertion,
	observation: Observation,
	options: VerifyAssertionsOptions,
): AssertionVerification {
	const tokens = assertion.tokens ?? tokenize(assertion.expected ?? assertion.description);
	if (tokens.length === 0) {
		return inconclusive(assertion, "token-overlap assertion has no comparable tokens", 0);
	}

	const observedTokens = new Set(tokenize(observationSearchText(observation)));
	const overlapCount = tokens.filter((token) => observedTokens.has(token)).length;
	const overlapRatio = overlapCount / tokens.length;
	const matchedValue = `${overlapCount}/${tokens.length} tokens`;

	if (!(options.allowLowConfidenceFallback ?? false)) {
		return {
			assertion,
			status: "inconclusive",
			confidence: assertion.confidence,
			reason: "low-confidence fallback requires explicit allowLowConfidenceFallback",
			matchedValue,
		};
	}

	const threshold = options.tokenOverlapThreshold ?? DEFAULT_TOKEN_OVERLAP_THRESHOLD;
	if (overlapRatio >= threshold) {
		return pass(assertion, "fallback token overlap met threshold", assertion.confidence, matchedValue);
	}
	return fail(assertion, "fallback token overlap missed threshold", assertion.confidence, matchedValue);
}

function findElement(
	observation: Observation,
	selector: string,
): { readonly selector: string; readonly value: string } | undefined {
	return observation.dom?.find((element) => element.selector === selector);
}

function observationText(observation: Observation): string {
	return [observation.title, observation.text, ...(observation.dom ?? []).map((element) => element.value)]
		.filter((value): value is string => value !== undefined && value.length > 0)
		.join("\n");
}

function observationSearchText(observation: Observation): string {
	return [observation.url, observationText(observation)].join("\n");
}

function pass(
	assertion: SuccessAssertion,
	reason: string,
	confidence: number,
	matchedValue?: string,
): AssertionVerification {
	return verification(assertion, "pass", reason, confidence, matchedValue);
}

function fail(
	assertion: SuccessAssertion,
	reason: string,
	confidence: number,
	matchedValue?: string,
): AssertionVerification {
	return verification(assertion, "fail", reason, confidence, matchedValue);
}

function inconclusive(
	assertion: SuccessAssertion,
	reason: string,
	confidence: number,
	matchedValue?: string,
): AssertionVerification {
	return verification(assertion, "inconclusive", reason, confidence, matchedValue);
}

function verification(
	assertion: SuccessAssertion,
	status: AssertionVerificationStatus,
	reason: string,
	confidence: number,
	matchedValue?: string,
): AssertionVerification {
	return {
		assertion,
		status,
		confidence: clamp01(confidence),
		reason,
		...(matchedValue !== undefined ? { matchedValue } : {}),
	};
}

function normalizeExpected(value: string): string {
	const normalized = normalizeWhitespace(value);
	return getQuotedPhrase(normalized) ?? normalized;
}

function getQuotedPhrase(value: string): string | undefined {
	if (value.length < 2) {
		return undefined;
	}
	const exactFirst = value[0];
	const exactLast = value[value.length - 1];
	if ((exactFirst === '"' && exactLast === '"') || (exactFirst === "'" && exactLast === "'")) {
		return normalizeWhitespace(value.slice(1, -1));
	}
	const embedded = value.match(/["']([^"']+)["']/u);
	return embedded ? normalizeWhitespace(embedded[1]) : undefined;
}

function containsNormalized(haystack: string, needle: string): boolean {
	const normalizedNeedle = normalizeForMatch(needle);
	return normalizedNeedle.length > 0 && normalizeForMatch(haystack).includes(normalizedNeedle);
}

function normalizeForMatch(value: string): string {
	return normalizeWhitespace(value).toLowerCase();
}

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/gu, " ");
}

function tokenize(value: string): readonly string[] {
	return normalizeForMatch(value).match(/[a-z0-9]+/gu) ?? [];
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}

function stableHash(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}
