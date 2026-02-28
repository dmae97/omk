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

	it("keeps auth header client-metadata aligned with CLI defaults", () => {
		const headers = getAntigravityAuthHeaders();
		const rawMetadata = headers["Client-Metadata"];
		expect(rawMetadata).toBeDefined();
		const metadata = JSON.parse(rawMetadata) as {
			ideType?: string;
			platform?: string;
			pluginType?: string;
		};
		expect(metadata).toEqual({
			ideType: "IDE_UNSPECIFIED",
			platform: "PLATFORM_UNSPECIFIED",
			pluginType: "GEMINI",
		});
	});
});
