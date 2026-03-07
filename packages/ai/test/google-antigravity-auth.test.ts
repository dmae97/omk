import { describe, expect, it } from "bun:test";
import { getAntigravityAuthHeaders } from "../src/providers/google-gemini-cli";
import { ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA } from "../src/utils/oauth/google-antigravity";

describe("Google Antigravity auth alignment", () => {
	it("uses ANTIGRAVITY ideType in loadCodeAssist metadata payload", () => {
		expect(ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA).toEqual({
			ideType: "ANTIGRAVITY",
			platform: "PLATFORM_UNSPECIFIED",
			pluginType: "GEMINI",
		});
	});

	it("auth headers contain only User-Agent (no X-Goog-Api-Client or Client-Metadata)", () => {
		// Verified from Antigravity binary (kae.w / kae.y in main.js):
		// the real client sends only Content-Type + User-Agent for all API calls.
		// Product identification (ideType, ideName) goes in the protobuf request body.
		const headers = getAntigravityAuthHeaders();
		expect(Object.keys(headers)).toEqual(["User-Agent"]);
		expect(headers["User-Agent"]).toMatch(/^antigravity\//);
	});
});
