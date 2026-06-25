import { describe, expect, it } from "vitest";

import { parseCriterionToAssertion, verifyAssertions } from "../examples/extensions/aside-computer-use/assertions.ts";
import type { Observation, SuccessCriterion } from "../examples/extensions/aside-computer-use/types.ts";

const observation: Observation = {
	url: "https://example.com/dashboard/checkout?status=ok",
	title: "Checkout Success",
	text: "Your order is complete. Total $5.",
	dom: [
		{ selector: "#status", value: "Complete" },
		{ selector: "#pay", value: "Pay now" },
	],
};

describe("aside assertion helpers", () => {
	it("parses structured success criteria into typed assertions", () => {
		expect(parseCriterionToAssertion("dom:#status=Complete")).toMatchObject({
			kind: "element_value",
			target: "#status",
			expected: "Complete",
			confidence: 0.95,
			required: true,
		});
		expect(parseCriterionToAssertion("visible:#pay")).toMatchObject({
			kind: "element_visible",
			target: "#pay",
			confidence: 0.95,
		});
		expect(parseCriterionToAssertion("url:/dashboard/checkout")).toMatchObject({
			kind: "url",
			expected: "/dashboard/checkout",
			confidence: 0.8,
		});
		expect(parseCriterionToAssertion("title:Checkout Success")).toMatchObject({
			kind: "title",
			expected: "Checkout Success",
			confidence: 0.7,
		});
		expect(parseCriterionToAssertion("text:order is complete")).toMatchObject({
			kind: "text",
			expected: "order is complete",
			confidence: 0.7,
		});
		expect(parseCriterionToAssertion('"order is complete"')).toMatchObject({
			kind: "text",
			expected: "order is complete",
			confidence: 0.7,
		});
		expect(parseCriterionToAssertion("absent:Payment failed")).toMatchObject({
			kind: "negative_text_absent",
			expected: "Payment failed",
			confidence: 0.7,
		});
	});

	it("keeps success criterion ids and falls back to low-confidence token overlap", () => {
		const criterion: SuccessCriterion = {
			id: "goal-1",
			description: "checkout order complete",
		};

		const assertion = parseCriterionToAssertion(criterion);

		expect(assertion).toMatchObject({
			id: "goal-1",
			kind: "token_overlap",
			confidence: 0.45,
			required: true,
		});
		expect(assertion.tokens).toEqual(["checkout", "order", "complete"]);
	});

	it("passes only when all required high-confidence assertions pass", () => {
		const assertions = [
			parseCriterionToAssertion("dom:#status=Complete"),
			parseCriterionToAssertion("visible:#pay"),
			parseCriterionToAssertion("url:/dashboard/checkout"),
			parseCriterionToAssertion("title:Success"),
			parseCriterionToAssertion("text:order is complete"),
			parseCriterionToAssertion("absent:Payment failed"),
		];

		const verification = verifyAssertions(assertions, observation);

		expect(verification.status).toBe("pass");
		expect(verification.assertions).toHaveLength(assertions.length);
		expect(verification.assertions.every((result) => result.status === "pass")).toBe(true);
		expect(verification.confidence).toBeGreaterThanOrEqual(0.7);
	});

	it("fails when a required assertion is contradicted", () => {
		const verification = verifyAssertions(
			[parseCriterionToAssertion("dom:#status=Pending"), parseCriterionToAssertion("absent:order is complete")],
			observation,
		);

		expect(verification.status).toBe("fail");
		expect(verification.assertions.map((result) => result.status)).toEqual(["fail", "fail"]);
	});

	it("treats fallback token overlap as inconclusive unless explicitly allowed", () => {
		const fallbackAssertion = parseCriterionToAssertion("checkout order complete");

		expect(verifyAssertions([fallbackAssertion], observation)).toMatchObject({
			status: "inconclusive",
		});
		expect(verifyAssertions([fallbackAssertion], observation, { allowLowConfidenceFallback: true })).toMatchObject({
			status: "pass",
			confidence: 0.45,
		});
	});

	it("marks otherwise passing assertions inconclusive below the configured confidence floor", () => {
		const verification = verifyAssertions([parseCriterionToAssertion("title:Success")], observation, {
			minConfidence: 0.8,
		});

		expect(verification.status).toBe("inconclusive");
		expect(verification.assertions[0]?.status).toBe("pass");
		expect(verification.assertions[0]?.confidence).toBe(0.7);
	});
});
