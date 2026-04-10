import { describe, expect, it } from "bun:test";
import { rewriteCopilotAuthError } from "../src/utils/http-inspector";

function errorWithStatus(status: number): Error {
	const err = new Error(`${status} Unauthorized`);
	(err as any).status = status;
	return err;
}

describe("rewriteCopilotAuthError", () => {
	it("returns original message for non-copilot providers", () => {
		const err = errorWithStatus(401);
		expect(rewriteCopilotAuthError("some error", err, "openai")).toBe("some error");
	});

	it("returns original message for non-401/403 errors", () => {
		const err = errorWithStatus(500);
		expect(rewriteCopilotAuthError("server error", err, "github-copilot")).toBe("server error");
	});

	it("rewrites message for 401 with github-copilot provider", () => {
		const err = errorWithStatus(401);
		const result = rewriteCopilotAuthError("401 Unauthorized: ...", err, "github-copilot");
		expect(result).toContain("GitHub Copilot authentication failed (HTTP 401)");
		expect(result).toContain("/login github-copilot");
	});

	it("rewrites 403 with access-denied message (not auth-failed, to avoid credential removal)", () => {
		const err = errorWithStatus(403);
		const result = rewriteCopilotAuthError("403 Forbidden", err, "github-copilot");
		expect(result).toContain("GitHub Copilot access denied (HTTP 403)");
		expect(result).not.toContain("GitHub Copilot authentication failed");
		expect(result).not.toContain("/login github-copilot");
	});
});
