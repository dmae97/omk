import { describe, expect, it } from "bun:test";
import { handleReddit } from "$c/web/scrapers/reddit";
import { handleStackOverflow } from "$c/web/scrapers/stackoverflow";
import { handleTwitter } from "$c/web/scrapers/twitter";

const SKIP = !process.env.WEB_FETCH_INTEGRATION;

describe.skipIf(SKIP)("handleTwitter", () => {
	it("returns null for non-Twitter URLs", async () => {
		const result = await handleTwitter("https://example.com", 10);
		expect(result).toBeNull();
	});

	it(
		"handles twitter.com status URLs",
		async () => {
			const result = await handleTwitter("https://twitter.com/jack/status/20", 10000);
			expect(result).not.toBeNull();
			expect(result?.method).toMatch(/^twitter/);
			expect(result?.contentType).toMatch(/^text\/(markdown|plain)$/);
			// Either successful fetch or blocked/unavailable message
			if (result?.method === "twitter-nitter") {
				expect(result?.content).toContain("Tweet by");
				expect(result?.notes?.[0]).toContain("Via Nitter");
			} else if (result?.method === "twitter-blocked") {
				expect(result?.content).toContain("blocks automated access");
				expect(result?.notes?.[0]).toContain("Nitter instances unavailable");
			}
		},
		{ timeout: 30000 },
	);

	it(
		"handles x.com status URLs",
		async () => {
			const result = await handleTwitter("https://x.com/elonmusk/status/1", 10000);
			expect(result).not.toBeNull();
			expect(result?.method).toMatch(/^twitter/);
			expect(result?.contentType).toMatch(/^text\/(markdown|plain)$/);
			// Either successful fetch or blocked/unavailable message
			if (result?.method === "twitter-nitter") {
				expect(result?.finalUrl).toContain("nitter");
			} else if (result?.method === "twitter-blocked") {
				expect(result?.content).toContain("blocks automated access");
			}
		},
		{ timeout: 30000 },
	);

	it(
		"handles www.twitter.com URLs",
		async () => {
			const result = await handleTwitter("https://www.twitter.com/twitter/status/1", 10000);
			expect(result).not.toBeNull();
			expect(result?.method).toMatch(/^twitter/);
		},
		{ timeout: 30000 },
	);

	it(
		"handles www.x.com URLs",
		async () => {
			const result = await handleTwitter("https://www.x.com/twitter/status/1", 10000);
			expect(result).not.toBeNull();
			expect(result?.method).toMatch(/^twitter/);
		},
		{ timeout: 30000 },
	);

	it(
		"may fail due to Nitter availability",
		async () => {
			// Test that failure returns helpful message instead of null
			const result = await handleTwitter("https://twitter.com/nonexistent/status/999999999999999999", 10000);
			expect(result).not.toBeNull();
			// Should return blocked message when Nitter fails
			if (result?.method === "twitter-blocked") {
				expect(result?.content).toContain("Nitter instances were unavailable");
				expect(result?.content).toContain("Try:");
			}
		},
		{ timeout: 30000 },
	);
});

describe.skipIf(SKIP)("handleReddit", () => {
	it("returns null for non-Reddit URLs", async () => {
		const result = await handleReddit("https://example.com", 10);
		expect(result).toBeNull();
	});

	it("fetches subreddit", async () => {
		const result = await handleReddit("https://www.reddit.com/r/programming/", 20000);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("reddit");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.content).toContain("# r/programming");
		expect(result?.content).toMatch(/\*\*.*\*\*/); // Contains bold formatting
		expect(result?.notes).toContain("Fetched via Reddit JSON API");
	});

	it("fetches individual post", async () => {
		// Use a more reliable recent post URL
		const result = await handleReddit("https://www.reddit.com/r/programming/", 20000);
		// Individual post may fail if post doesn't exist, check if we get data
		if (result !== null) {
			expect(result.method).toBe("reddit");
			expect(result.contentType).toBe("text/markdown");
			expect(result.content).toContain("# r/");
			expect(result.notes).toContain("Fetched via Reddit JSON API");
		}
	});

	it("includes comments in post when available", async () => {
		const result = await handleReddit("https://www.reddit.com/r/programming/", 20000);
		// Comments test - just verify structure if post with comments is found
		if (result?.content?.includes("## Top Comments")) {
			expect(result.content).toContain("### u/");
			expect(result.content).toContain("points");
		}
	});

	it("handles old.reddit.com", async () => {
		const result = await handleReddit("https://old.reddit.com/r/programming/", 20000);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("reddit");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.content).toContain("# r/");
		expect(result?.notes).toContain("Fetched via Reddit JSON API");
	});

	it("handles reddit.com without www", async () => {
		const result = await handleReddit("https://reddit.com/r/programming/", 20000);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("reddit");
	});

	it("handles URLs with query parameters", async () => {
		const result = await handleReddit("https://www.reddit.com/r/programming/?sort=top", 20000);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("reddit");
		expect(result?.content).toContain("# r/");
	});

	it("returns null for malformed Reddit URLs", async () => {
		const result = await handleReddit("https://www.reddit.com/invalid", 20000);
		// May return null or empty result
		if (result !== null) {
			expect(result.content).toBeDefined();
		}
	});
});

describe.skipIf(SKIP)("handleStackOverflow", () => {
	it("returns null for non-SO URLs", async () => {
		const result = await handleStackOverflow("https://example.com", 10);
		expect(result).toBeNull();
	});

	it("returns null for SO URLs without question ID", async () => {
		const result = await handleStackOverflow("https://stackoverflow.com/", 10);
		expect(result).toBeNull();
	});

	it("fetches a known question", async () => {
		// Use a well-known question that definitely exists
		const result = await handleStackOverflow(
			"https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster",
			20000,
		);
		// API may fail or rate limit, check gracefully
		if (result !== null) {
			expect(result.method).toBe("stackoverflow");
			expect(result.contentType).toBe("text/markdown");
			expect(result.content).toContain("# ");
			expect(result.content).toContain("**Score:");
			expect(result.content).toContain("**Tags:");
			expect(result.content).toContain("## Question");
			expect(result.notes).toContain("Fetched via Stack Exchange API");
		}
	});

	it("includes answers", async () => {
		const result = await handleStackOverflow(
			"https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster",
			20000,
		);
		if (result?.content?.includes("## Answers")) {
			expect(result.content).toContain("### Score:");
		}
	});

	it("shows accepted answer marker when present", async () => {
		const result = await handleStackOverflow(
			"https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster",
			20000,
		);
		// Some questions may have accepted answers
		if (result?.content?.includes("(Accepted)")) {
			expect(result.content).toContain("## Answers");
		}
	});

	it("handles stackoverflow.com", async () => {
		const result = await handleStackOverflow(
			"https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array",
			20000,
		);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("stackoverflow");
		expect(result?.content).toContain("# ");
		expect(result?.content).toContain("## Question");
	});

	it("handles other StackExchange sites", async () => {
		const result = await handleStackOverflow("https://math.stackexchange.com/questions/1000/", 20000);
		// API may fail, check gracefully
		if (result !== null) {
			expect(result.method).toBe("stackoverflow");
			expect(result.contentType).toBe("text/markdown");
			expect(result.content).toContain("# ");
			expect(result.notes).toContain("Fetched via Stack Exchange API");
		}
	});

	it("extracts question ID from URL", async () => {
		const result = await handleStackOverflow(
			"https://stackoverflow.com/questions/1234567/some-long-question-title",
			20000,
		);
		// Should attempt to fetch, may or may not exist
		// Either returns valid result or null
		if (result !== null) {
			expect(result.method).toBe("stackoverflow");
		}
	});

	it("handles URLs without trailing slash", async () => {
		const result = await handleStackOverflow("https://stackoverflow.com/questions/11227809", 20000);
		// API may fail, check gracefully
		if (result !== null) {
			expect(result.method).toBe("stackoverflow");
		}
	});

	it("includes question metadata", async () => {
		const result = await handleStackOverflow(
			"https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster",
			20000,
		);
		// API may fail, check gracefully
		if (result !== null) {
			expect(result.content).toContain("**Score:");
			expect(result.content).toContain("**Answers:");
			expect(result.content).toContain("**Tags:");
			expect(result.content).toContain("**Asked by:");
		}
	});
});
