import { describe, expect, it } from "bun:test";
import { hookFetch } from "@oh-my-pi/pi-utils";
import { executeCodeSearch } from "../../src/web/search/code-search";

function getFirstTextContent(result: { content: Array<{ type: string; text?: string }> }): string {
	const firstContent = result.content[0];
	if (firstContent?.type === "text") return firstContent.text ?? "";
	return "";
}

describe("code_search", () => {
	it("normalizes Exa response and surfaces it as code search result", async () => {
		using _hook = hookFetch(
			() =>
				new Response(
					JSON.stringify({
						result: {
							content: [
								{
									type: "text",
									text: "Need the official or source-backed way to silence direnv loading output.",
								},
							],
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		);

		const result = await executeCodeSearch({ query: "DIRENV_LOG_FORMAT direnv loading silence" });
		const output = getFirstTextContent(result);
		expect(output).toContain("Code search via exa");
		expect(output).toContain("Need the official or source-backed way to silence direnv loading output.");
		expect(result.details?.provider).toBe("exa");
		expect(result.details?.response?.sources[0]?.snippet).toContain(
			"Need the official or source-backed way to silence direnv loading output.",
		);
	});
});
