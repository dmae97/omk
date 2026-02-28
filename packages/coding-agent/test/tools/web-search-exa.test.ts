import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	buildExaRequestBody,
	normalizeSearchType,
	searchExa,
	synthesizeAnswer,
} from "../../src/web/search/providers/exa";

// ────────────────────────────────────────────────────────────
// Unit tests for pure helpers (no mocking needed)
// ────────────────────────────────────────────────────────────

describe("normalizeSearchType", () => {
	it("returns 'auto' for undefined input", () => {
		expect(normalizeSearchType(undefined)).toBe("auto");
	});

	it("maps 'keyword' to 'fast'", () => {
		expect(normalizeSearchType("keyword")).toBe("fast");
	});

	it("passes through 'neural' unchanged", () => {
		expect(normalizeSearchType("neural")).toBe("neural");
	});

	it("passes through 'deep' unchanged", () => {
		expect(normalizeSearchType("deep")).toBe("deep");
	});

	it("passes through 'auto' unchanged", () => {
		expect(normalizeSearchType("auto")).toBe("auto");
	});

	it("passes through 'fast' unchanged", () => {
		expect(normalizeSearchType("fast")).toBe("fast");
	});
});

describe("buildExaRequestBody", () => {
	it("builds correct minimal body with defaults", () => {
		const body = buildExaRequestBody({ query: "test query" });
		expect(body).toEqual({
			query: "test query",
			numResults: 10,
			type: "auto",
			contents: { summary: { query: "test query" } },
		});
	});

	it("includes contents.summary with the search query", () => {
		const body = buildExaRequestBody({ query: "how does React work" });
		expect(body.contents).toEqual({ summary: { query: "how does React work" } });
	});

	it("applies num_results override", () => {
		const body = buildExaRequestBody({ query: "q", num_results: 5 });
		expect(body.numResults).toBe(5);
	});

	it("normalizes keyword type to fast", () => {
		const body = buildExaRequestBody({ query: "q", type: "keyword" });
		expect(body.type).toBe("fast");
	});

	it("includes domain filters when specified", () => {
		const body = buildExaRequestBody({
			query: "q",
			include_domains: ["example.com"],
			exclude_domains: ["bad.com"],
		});
		expect(body.includeDomains).toEqual(["example.com"]);
		expect(body.excludeDomains).toEqual(["bad.com"]);
	});

	it("omits domain filters when arrays are empty", () => {
		const body = buildExaRequestBody({
			query: "q",
			include_domains: [],
			exclude_domains: [],
		});
		expect(body.includeDomains).toBeUndefined();
		expect(body.excludeDomains).toBeUndefined();
	});

	it("includes date filters when specified", () => {
		const body = buildExaRequestBody({
			query: "q",
			start_published_date: "2024-01-01",
			end_published_date: "2024-12-31",
		});
		expect(body.startPublishedDate).toBe("2024-01-01");
		expect(body.endPublishedDate).toBe("2024-12-31");
	});
});

describe("synthesizeAnswer", () => {
	it("returns undefined when results array is empty", () => {
		expect(synthesizeAnswer([])).toBeUndefined();
	});

	it("returns undefined when no result has a summary", () => {
		const results = [
			{ title: "A", url: "https://a.com", summary: null },
			{ title: "B", url: "https://b.com", summary: undefined },
			{ title: "C", url: "https://c.com" },
		];
		expect(synthesizeAnswer(results)).toBeUndefined();
	});

	it("returns undefined when summaries are empty strings", () => {
		const results = [
			{ title: "A", url: "https://a.com", summary: "" },
			{ title: "B", url: "https://b.com", summary: "   " },
		];
		expect(synthesizeAnswer(results)).toBeUndefined();
	});

	it("synthesizes answer from a single summary", () => {
		const results = [{ title: "Page One", url: "https://one.com", summary: "Summary of page one." }];
		const answer = synthesizeAnswer(results);
		expect(answer).toBe("**Page One**: Summary of page one.");
	});

	it("synthesizes answer from multiple summaries joined by double newlines", () => {
		const results = [
			{ title: "A", url: "https://a.com", summary: "Summary A" },
			{ title: "B", url: "https://b.com", summary: "Summary B" },
		];
		const answer = synthesizeAnswer(results);
		expect(answer).toBe("**A**: Summary A\n\n**B**: Summary B");
	});

	it("limits to MAX_ANSWER_SUMMARIES (3) results", () => {
		const results = [
			{ title: "A", url: "https://a.com", summary: "SA" },
			{ title: "B", url: "https://b.com", summary: "SB" },
			{ title: "C", url: "https://c.com", summary: "SC" },
			{ title: "D", url: "https://d.com", summary: "SD" },
			{ title: "E", url: "https://e.com", summary: "SE" },
		];
		const answer = synthesizeAnswer(results)!;
		expect(answer.split("\n\n")).toHaveLength(3);
		expect(answer).toContain("**A**: SA");
		expect(answer).toContain("**C**: SC");
		expect(answer).not.toContain("**D**");
	});

	it("skips results with missing summaries but includes ones that have them", () => {
		const results = [
			{ title: "NoSummary", url: "https://no.com", summary: null },
			{ title: "HasSummary", url: "https://yes.com", summary: "Good stuff" },
		];
		const answer = synthesizeAnswer(results);
		expect(answer).toBe("**HasSummary**: Good stuff");
	});

	it("uses url as fallback title when title is missing", () => {
		const results = [{ url: "https://notitle.com", summary: "Content here" }];
		const answer = synthesizeAnswer(results);
		expect(answer).toBe("**https://notitle.com**: Content here");
	});

	it("uses 'Untitled' when both title and url are missing", () => {
		const results = [{ summary: "Orphan content" }];
		const answer = synthesizeAnswer(results);
		expect(answer).toBe("**Untitled**: Orphan content");
	});

	it("trims whitespace from summaries", () => {
		const results = [{ title: "T", url: "https://t.com", summary: "  padded summary  " }];
		const answer = synthesizeAnswer(results);
		expect(answer).toBe("**T**: padded summary");
	});
});

// ────────────────────────────────────────────────────────────
// Integration tests for searchExa (mock fetch + env)
// ────────────────────────────────────────────────────────────

function makeMockExaResponse(overrides: Record<string, unknown> = {}) {
	return {
		requestId: "req-123",
		resolvedSearchType: "auto",
		results: [
			{
				title: "Page Alpha",
				url: "https://alpha.com",
				author: "Author A",
				publishedDate: "2024-06-01",
				text: "Full text of alpha",
				highlights: ["highlight alpha"],
				summary: "Alpha is about X.",
			},
			{
				title: "Page Beta",
				url: "https://beta.com",
				author: null,
				publishedDate: null,
				text: null,
				highlights: null,
				summary: "Beta covers Y.",
			},
			{
				title: "Page Gamma",
				url: "https://gamma.com",
				author: "Author G",
				publishedDate: "2024-07-15",
				text: "Gamma text",
				highlights: ["gamma hl"],
				summary: "Gamma discusses Z.",
			},
		],
		...overrides,
	};
}

describe("searchExa", () => {
	const originalFetch = globalThis.fetch;
	let capturedRequestBody: Record<string, unknown> | null = null;

	beforeEach(() => {
		capturedRequestBody = null;
		process.env.EXA_API_KEY = "test-key-123";
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		delete process.env.EXA_API_KEY;
	});

	function mockFetch(responseBody: unknown, status = 200) {
		globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
			if (init?.body) {
				capturedRequestBody = JSON.parse(init.body as string);
			}
			return new Response(JSON.stringify(responseBody), {
				status,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;
	}

	it("populates answer from per-result summaries", async () => {
		mockFetch(makeMockExaResponse());
		const result = await searchExa({ query: "test query" });
		expect(result.provider).toBe("exa");
		expect(result.answer).toBeDefined();
		expect(result.answer).toContain("**Page Alpha**: Alpha is about X.");
		expect(result.answer).toContain("**Page Beta**: Beta covers Y.");
		expect(result.answer).toContain("**Page Gamma**: Gamma discusses Z.");
		expect(result.requestId).toBe("req-123");
	});

	it("returns answer=undefined when no summaries are present", async () => {
		mockFetch(
			makeMockExaResponse({ results: [{ title: "No Summary", url: "https://nosummary.com", text: "some text" }] }),
		);
		const result = await searchExa({ query: "no answer query" });
		expect(result.provider).toBe("exa");
		expect(result.answer).toBeUndefined();
		expect(result.sources).toHaveLength(1);
	});

	it("returns answer=undefined when results array is empty", async () => {
		mockFetch(makeMockExaResponse({ results: [] }));
		const result = await searchExa({ query: "empty" });
		expect(result.answer).toBeUndefined();
		expect(result.sources).toHaveLength(0);
	});

	it("returns answer=undefined when results is missing from response", async () => {
		mockFetch({ requestId: "req-empty" });
		const result = await searchExa({ query: "nothing" });
		expect(result.answer).toBeUndefined();
		expect(result.sources).toHaveLength(0);
	});

	it("sends contents.summary in request body", async () => {
		mockFetch(makeMockExaResponse());
		await searchExa({ query: "check body" });
		expect(capturedRequestBody).toBeDefined();
		expect(capturedRequestBody!.contents).toEqual({ summary: { query: "check body" } });
	});

	it("sends correct full request shape", async () => {
		mockFetch(makeMockExaResponse());
		await searchExa({ query: "shape test", num_results: 5, type: "neural" });
		expect(capturedRequestBody).toEqual({
			query: "shape test",
			numResults: 5,
			type: "neural",
			contents: { summary: { query: "shape test" } },
		});
	});

	it("prefers summary over text for snippet field", async () => {
		mockFetch(
			makeMockExaResponse({
				results: [{ title: "Has Both", url: "https://both.com", text: "full text here", summary: "summary here" }],
			}),
		);
		const result = await searchExa({ query: "snippet test" });
		expect(result.sources[0].snippet).toBe("summary here");
	});

	it("falls back to text when summary is null", async () => {
		mockFetch(
			makeMockExaResponse({
				results: [{ title: "Text Only", url: "https://text.com", text: "fallback text", summary: null }],
			}),
		);
		const result = await searchExa({ query: "fallback" });
		expect(result.sources[0].snippet).toBe("fallback text");
	});

	it("falls back to highlights when both summary and text are null", async () => {
		mockFetch(
			makeMockExaResponse({
				results: [
					{
						title: "Highlight Only",
						url: "https://hl.com",
						text: null,
						summary: null,
						highlights: ["hl1", "hl2"],
					},
				],
			}),
		);
		const result = await searchExa({ query: "highlights" });
		expect(result.sources[0].snippet).toBe("hl1 hl2");
	});

	it("skips results without url", async () => {
		mockFetch(
			makeMockExaResponse({
				results: [
					{ title: "No URL", url: null, summary: "orphan" },
					{ title: "Has URL", url: "https://valid.com", summary: "valid" },
				],
			}),
		);
		const result = await searchExa({ query: "url filter" });
		expect(result.sources).toHaveLength(1);
		expect(result.sources[0].url).toBe("https://valid.com");
	});

	it("falls back to text when summary is empty string (not just null)", async () => {
		mockFetch(
			makeMockExaResponse({
				results: [{ title: "Empty Summary", url: "https://empty.com", text: "real text", summary: "" }],
			}),
		);
		const result = await searchExa({ query: "empty summary fallback" });
		expect(result.sources[0].snippet).toBe("real text");
	});

	it("does not include url-less results in synthesized answer", async () => {
		mockFetch(
			makeMockExaResponse({
				results: [
					{ title: "No URL", url: null, summary: "ghost summary" },
					{ title: "Has URL", url: "https://valid.com", summary: "real summary" },
				],
			}),
		);
		const result = await searchExa({ query: "url filter answer" });
		expect(result.answer).toBeDefined();
		expect(result.answer).not.toContain("ghost summary");
		expect(result.answer).toContain("**Has URL**: real summary");
	});

	it("uses Exa MCP when API key is missing", async () => {
		delete process.env.EXA_API_KEY;
		let calledUrl = "";
		globalThis.fetch = mock(async (url: string | URL | Request) => {
			calledUrl = String(url);
			return new Response(
				JSON.stringify({ jsonrpc: "2.0", id: "mcp-1", result: makeMockExaResponse() }),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;

		const result = await searchExa({ query: "no key" });
		expect(result.provider).toBe("exa");
		expect(result.sources).toHaveLength(3);
		expect(calledUrl).toContain("https://mcp.exa.ai/mcp");
		expect(calledUrl).toContain("tools=web_search_exa");
		expect(calledUrl).not.toContain("exaApiKey=");
	});

	it("throws SearchProviderError on non-ok HTTP response", async () => {
		mockFetch("Forbidden", 403);
		await expect(searchExa({ query: "forbidden" })).rejects.toThrow("Exa API error (403)");
	});
});
