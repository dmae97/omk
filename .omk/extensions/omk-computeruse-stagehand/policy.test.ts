import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizeAction, authorizeNavigation, DEFAULT_ALLOWED_ORIGINS } from "./policy.ts";

describe("authorizeNavigation", () => {
	it("allows localhost when it is on the default allowlist", () => {
		// Given
		const url = "http://localhost:3000/dashboard";

		// When
		const decision = authorizeNavigation(url, DEFAULT_ALLOWED_ORIGINS);

		// Then
		assert.deepEqual(decision, { kind: "allow", origin: "http://localhost:3000" });
	});

	it("requires approval for a public HTTPS origin", () => {
		// Given
		const url = "https://example.com/account";

		// When
		const decision = authorizeNavigation(url, DEFAULT_ALLOWED_ORIGINS);

		// Then
		assert.deepEqual(decision, { kind: "approve", origin: "https://example.com" });
	});

	it("denies non-HTTP protocols", () => {
		// Given
		const url = "file:///home/user/private.txt";

		// When
		const decision = authorizeNavigation(url, DEFAULT_ALLOWED_ORIGINS);

		// Then
		assert.deepEqual(decision, { kind: "deny", reason: "Only HTTP(S) navigation is allowed" });
	});

	it("denies malformed URLs", () => {
		// Given
		const url = "not a url";

		// When
		const decision = authorizeNavigation(url, DEFAULT_ALLOWED_ORIGINS);

		// Then
		assert.deepEqual(decision, { kind: "deny", reason: "Invalid URL" });
	});
});

describe("authorizeAction", () => {
	it("denies critical account and credential actions", () => {
		// Given
		const instructions = [
			"enter the account password",
			"purchase the product",
			"delete the user account",
			"change the security settings",
		];

		// When
		const decisions = instructions.map((instruction) => authorizeAction(instruction));

		// Then
		for (const decision of decisions) {
			assert.deepEqual(decision, { kind: "deny", reason: "Critical browser action denied" });
		}
	});

	it("requires approval for an ordinary semantic action", () => {
		// Given
		const instruction = "open the pricing details accordion";

		// When
		const decision = authorizeAction(instruction);

		// Then
		assert.deepEqual(decision, { kind: "approve" });
	});
});
