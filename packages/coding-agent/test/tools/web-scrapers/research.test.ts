import { describe, expect, it } from "bun:test";
import { handleBiorxiv } from "$c/web/scrapers/biorxiv";
import { handleOpenLibrary } from "$c/web/scrapers/openlibrary";
import { handleWikidata } from "$c/web/scrapers/wikidata";

const SKIP = !process.env.WEB_FETCH_INTEGRATION;

describe.skipIf(SKIP)("handleWikidata", () => {
	it("returns null for non-matching URLs", async () => {
		const result = await handleWikidata("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-wikidata URLs", async () => {
		const result = await handleWikidata("https://wikipedia.org/wiki/Apple_Inc", 20);
		expect(result).toBeNull();
	});

	it("fetches Q312 - Apple Inc", async () => {
		const result = await handleWikidata("https://www.wikidata.org/wiki/Q312", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("wikidata");
		expect(result?.content).toContain("Apple");
		expect(result?.content).toContain("Q312");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});

	it("fetches Q5 - human (entity)", async () => {
		const result = await handleWikidata("https://www.wikidata.org/entity/Q5", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("wikidata");
		expect(result?.content).toContain("human");
		expect(result?.content).toContain("Q5");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});
});

describe.skipIf(SKIP)("handleOpenLibrary", () => {
	it("returns null for non-matching URLs", async () => {
		const result = await handleOpenLibrary("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-openlibrary URLs", async () => {
		const result = await handleOpenLibrary("https://amazon.com/books/123", 20);
		expect(result).toBeNull();
	});

	it("fetches by ISBN - Fantastic Mr Fox", async () => {
		const result = await handleOpenLibrary("https://openlibrary.org/isbn/9780140328721", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("openlibrary");
		expect(result?.content).toContain("Fantastic Mr");
		expect(result?.content).toContain("Roald Dahl");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});

	it("fetches work OL45804W - The Lord of the Rings", async () => {
		const result = await handleOpenLibrary("https://openlibrary.org/works/OL45804W", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("openlibrary");
		expect(result?.content).toContain("Lord of the Rings");
		expect(result?.content).toContain("Tolkien");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});
});

describe.skipIf(SKIP)("handleBiorxiv", () => {
	it("returns null for non-matching URLs", async () => {
		const result = await handleBiorxiv("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-biorxiv URLs", async () => {
		const result = await handleBiorxiv("https://nature.com/articles/123", 20);
		expect(result).toBeNull();
	});

	// Using the AlphaFold Protein Structure Database paper - highly cited and stable
	it("fetches bioRxiv preprint - AlphaFold database", async () => {
		const result = await handleBiorxiv("https://www.biorxiv.org/content/10.1101/2021.10.04.463034", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("biorxiv");
		expect(result?.content).toContain("AlphaFold");
		expect(result?.content).toContain("Abstract");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});

	// Testing with version suffix handling
	it("fetches bioRxiv preprint with version suffix", async () => {
		const result = await handleBiorxiv("https://www.biorxiv.org/content/10.1101/2021.10.04.463034v1", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("biorxiv");
		expect(result?.content).toContain("AlphaFold");
		expect(result?.contentType).toBe("text/markdown");
	});
});
