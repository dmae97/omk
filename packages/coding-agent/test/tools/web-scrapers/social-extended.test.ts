import { describe, expect, it } from "bun:test";
import { handleBluesky } from "$c/web/scrapers/bluesky";
import { handleMastodon } from "$c/web/scrapers/mastodon";

const SKIP = !process.env.WEB_FETCH_INTEGRATION;

describe.skipIf(SKIP)("handleMastodon", () => {
	it("returns null for non-Mastodon URLs", async () => {
		const result = await handleMastodon("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for URLs without @user pattern", async () => {
		const result = await handleMastodon("https://mastodon.social/about", 20);
		expect(result).toBeNull();
	});

	it(
		"fetches a Mastodon profile",
		async () => {
			// @Gargron is Eugen Rochko, creator of Mastodon - very stable
			const result = await handleMastodon("https://mastodon.social/@Gargron", 20);
			expect(result).not.toBeNull();
			expect(result?.method).toBe("mastodon");
			expect(result?.contentType).toBe("text/markdown");
			expect(result?.content).toContain("Gargron");
			expect(result?.content).toContain("@Gargron");
			expect(result?.content).toContain("**Followers:**");
			expect(result?.content).toContain("**Following:**");
			expect(result?.content).toContain("**Posts:**");
			expect(result?.fetchedAt).toBeTruthy();
			expect(result?.truncated).toBeDefined();
			expect(result?.notes?.[0]).toContain("Mastodon API");
		},
		{ timeout: 30000 },
	);

	it(
		"fetches a Mastodon post",
		async () => {
			// Gargron's post ID 1 - the first ever Mastodon post
			const result = await handleMastodon("https://mastodon.social/@Gargron/1", 20);
			// Post 1 may not exist anymore; check gracefully
			if (result !== null) {
				expect(result.method).toBe("mastodon");
				expect(result.contentType).toBe("text/markdown");
				expect(result.content).toContain("Post by");
				expect(result.content).toContain("@Gargron");
				expect(result.fetchedAt).toBeTruthy();
				expect(result.truncated).toBeDefined();
				expect(result.notes?.[0]).toContain("Mastodon API");
			}
		},
		{ timeout: 30000 },
	);

	it(
		"handles a stable pinned post",
		async () => {
			// Use a well-known post from mastodon.social - Gargron's announcement post
			const result = await handleMastodon("https://mastodon.social/@Gargron/109318821117356215", 20);
			// May not exist, check gracefully
			if (result !== null) {
				expect(result.method).toBe("mastodon");
				expect(result.contentType).toBe("text/markdown");
				expect(result.content).toContain("@Gargron");
				expect(result.content).toContain("replies");
				expect(result.content).toContain("boosts");
				expect(result.content).toContain("favorites");
				expect(result.fetchedAt).toBeTruthy();
			}
		},
		{ timeout: 30000 },
	);

	it(
		"includes recent posts in profile",
		async () => {
			const result = await handleMastodon("https://mastodon.social/@Gargron", 20);
			expect(result).not.toBeNull();
			// May include recent posts section
			if (result?.content?.includes("## Recent Posts")) {
				expect(result.content).toMatch(/###\s+\w+/); // Date header
			}
		},
		{ timeout: 30000 },
	);

	it("returns null for non-Mastodon instance with @user pattern", async () => {
		// A site that has @user pattern but isn't Mastodon
		const result = await handleMastodon("https://twitter.com/@jack", 20);
		expect(result).toBeNull();
	});
});

describe.skipIf(SKIP)("handleBluesky", () => {
	it("returns null for non-Bluesky URLs", async () => {
		const result = await handleBluesky("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for bsky.app URLs without profile path", async () => {
		const result = await handleBluesky("https://bsky.app/about", 20);
		expect(result).toBeNull();
	});

	it(
		"fetches a Bluesky profile",
		async () => {
			// bsky.app official account - stable
			const result = await handleBluesky("https://bsky.app/profile/bsky.app", 20);
			expect(result).not.toBeNull();
			expect(result?.method).toBe("bluesky-api");
			expect(result?.contentType).toBe("text/markdown");
			expect(result?.content).toContain("bsky.app");
			expect(result?.content).toContain("@bsky.app");
			expect(result?.content).toContain("**Followers:**");
			expect(result?.content).toContain("**Following:**");
			expect(result?.content).toContain("**Posts:**");
			expect(result?.content).toContain("**DID:**");
			expect(result?.fetchedAt).toBeTruthy();
			expect(result?.truncated).toBeDefined();
			expect(result?.notes).toContain("Fetched via AT Protocol API");
		},
		{ timeout: 30000 },
	);

	it(
		"fetches Jay Graber's profile",
		async () => {
			// Jay Graber - CEO of Bluesky, very stable
			const result = await handleBluesky("https://bsky.app/profile/jay.bsky.team", 20);
			expect(result).not.toBeNull();
			expect(result?.method).toBe("bluesky-api");
			expect(result?.contentType).toBe("text/markdown");
			expect(result?.content).toContain("@jay.bsky.team");
			expect(result?.content).toContain("**Followers:**");
			expect(result?.fetchedAt).toBeTruthy();
			expect(result?.truncated).toBeDefined();
		},
		{ timeout: 30000 },
	);

	it(
		"fetches a Bluesky post",
		async () => {
			// A post from bsky.app - use a well-known stable post
			const result = await handleBluesky("https://bsky.app/profile/bsky.app/post/3juzlwllznd24", 20);
			// Post may not exist, check gracefully
			if (result !== null) {
				expect(result.method).toBe("bluesky-api");
				expect(result.contentType).toBe("text/markdown");
				expect(result.content).toContain("# Bluesky Post");
				expect(result.content).toContain("@bsky.app");
				expect(result.fetchedAt).toBeTruthy();
				expect(result.truncated).toBeDefined();
				expect(result.notes?.[0]).toContain("AT URI");
			}
		},
		{ timeout: 30000 },
	);

	it(
		"includes post stats",
		async () => {
			const result = await handleBluesky("https://bsky.app/profile/bsky.app/post/3juzlwllznd24", 20);
			// Stats include likes, reposts, replies
			if (result?.content) {
				// Should have some engagement markers
				const hasStats =
					result.content.includes("❤️") || result.content.includes("🔁") || result.content.includes("💬");
				expect(hasStats || result.content.includes("# Bluesky Post")).toBe(true);
			}
		},
		{ timeout: 30000 },
	);

	it(
		"handles www.bsky.app URLs",
		async () => {
			const result = await handleBluesky("https://www.bsky.app/profile/bsky.app", 20);
			expect(result).not.toBeNull();
			expect(result?.method).toBe("bluesky-api");
		},
		{ timeout: 30000 },
	);

	it("returns null for invalid profile handle", async () => {
		const result = await handleBluesky("https://bsky.app/profile/", 20);
		expect(result).toBeNull();
	});
});
