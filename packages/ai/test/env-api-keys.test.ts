import { afterEach, describe, expect, it } from "vitest";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";

const originalCopilotGitHubToken = process.env.COPILOT_GITHUB_TOKEN;
const originalGhToken = process.env.GH_TOKEN;
const originalGitHubToken = process.env.GITHUB_TOKEN;
const originalZaiCodingCnApiKey = process.env.ZAI_CODING_CN_API_KEY;
const originalZylooApiKey = process.env.ZYLOO_API_KEY;
const originalMetaApiKey = process.env.META_API_KEY;
const originalMetaModelApiKey = process.env.META_MODEL_API_KEY;
const originalModelApiKey = process.env.MODEL_API_KEY;

afterEach(() => {
	if (originalCopilotGitHubToken === undefined) {
		delete process.env.COPILOT_GITHUB_TOKEN;
	} else {
		process.env.COPILOT_GITHUB_TOKEN = originalCopilotGitHubToken;
	}

	if (originalGhToken === undefined) {
		delete process.env.GH_TOKEN;
	} else {
		process.env.GH_TOKEN = originalGhToken;
	}

	if (originalGitHubToken === undefined) {
		delete process.env.GITHUB_TOKEN;
	} else {
		process.env.GITHUB_TOKEN = originalGitHubToken;
	}

	if (originalZaiCodingCnApiKey === undefined) {
		delete process.env.ZAI_CODING_CN_API_KEY;
	} else {
		process.env.ZAI_CODING_CN_API_KEY = originalZaiCodingCnApiKey;
	}

	if (originalZylooApiKey === undefined) {
		delete process.env.ZYLOO_API_KEY;
	} else {
		process.env.ZYLOO_API_KEY = originalZylooApiKey;
	}

	if (originalMetaApiKey === undefined) {
		delete process.env.META_API_KEY;
	} else {
		process.env.META_API_KEY = originalMetaApiKey;
	}

	if (originalMetaModelApiKey === undefined) {
		delete process.env.META_MODEL_API_KEY;
	} else {
		process.env.META_MODEL_API_KEY = originalMetaModelApiKey;
	}

	if (originalModelApiKey === undefined) {
		delete process.env.MODEL_API_KEY;
	} else {
		process.env.MODEL_API_KEY = originalModelApiKey;
	}
});

describe("environment API keys", () => {
	it("does not treat generic GitHub tokens as GitHub Copilot credentials", () => {
		delete process.env.COPILOT_GITHUB_TOKEN;
		process.env.GH_TOKEN = "gh-token";
		process.env.GITHUB_TOKEN = "github-token";

		expect(findEnvKeys("github-copilot")).toBeUndefined();
		expect(getEnvApiKey("github-copilot")).toBeUndefined();
	});

	it("resolves GitHub Copilot credentials from COPILOT_GITHUB_TOKEN", () => {
		process.env.COPILOT_GITHUB_TOKEN = "copilot-token";
		process.env.GH_TOKEN = "gh-token";
		process.env.GITHUB_TOKEN = "github-token";

		expect(findEnvKeys("github-copilot")).toEqual(["COPILOT_GITHUB_TOKEN"]);
		expect(getEnvApiKey("github-copilot")).toBe("copilot-token");
	});

	it("resolves ZAI China Coding Plan credentials from ZAI_CODING_CN_API_KEY", () => {
		process.env.ZAI_CODING_CN_API_KEY = "zai-coding-cn-token";

		expect(findEnvKeys("zai-coding-cn")).toEqual(["ZAI_CODING_CN_API_KEY"]);
		expect(getEnvApiKey("zai-coding-cn")).toBe("zai-coding-cn-token");
	});

	it("resolves Zyloo credentials from ZYLOO_API_KEY", () => {
		process.env.ZYLOO_API_KEY = "zyloo-token";

		expect(findEnvKeys("zyloo")).toEqual(["ZYLOO_API_KEY"]);
		expect(getEnvApiKey("zyloo")).toBe("zyloo-token");
	});

	// META_API_KEY is the name the Muse Code CLI onboarding sets, so a Muse Code user
	// typically already has it exported and expects OMK to pick it up.
	it("resolves Meta Model API credentials from META_API_KEY", () => {
		delete process.env.META_MODEL_API_KEY;
		delete process.env.MODEL_API_KEY;
		process.env.META_API_KEY = "muse-code-token";

		expect(findEnvKeys("meta")).toEqual(["META_API_KEY"]);
		expect(getEnvApiKey("meta")).toBe("muse-code-token");
	});

	it("resolves Meta Model API credentials from META_MODEL_API_KEY", () => {
		delete process.env.META_API_KEY;
		delete process.env.MODEL_API_KEY;
		process.env.META_MODEL_API_KEY = "meta-token";

		expect(findEnvKeys("meta")).toEqual(["META_MODEL_API_KEY"]);
		expect(getEnvApiKey("meta")).toBe("meta-token");
	});

	it("falls back to the generic MODEL_API_KEY that Meta's own docs use", () => {
		delete process.env.META_API_KEY;
		delete process.env.META_MODEL_API_KEY;
		process.env.MODEL_API_KEY = "generic-token";

		expect(findEnvKeys("meta")).toEqual(["MODEL_API_KEY"]);
		expect(getEnvApiKey("meta")).toBe("generic-token");
	});

	it("prefers the Muse Code name when several Meta key names are set", () => {
		process.env.META_API_KEY = "muse-code-token";
		process.env.META_MODEL_API_KEY = "meta-token";
		process.env.MODEL_API_KEY = "generic-token";

		expect(findEnvKeys("meta")).toEqual(["META_API_KEY", "META_MODEL_API_KEY", "MODEL_API_KEY"]);
		expect(getEnvApiKey("meta")).toBe("muse-code-token");
	});
});
