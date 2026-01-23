import { describe, expect, it } from "bun:test";
import { handleAur } from "$c/web/scrapers/aur";
import { handleBrew } from "$c/web/scrapers/brew";
import { handleMaven } from "$c/web/scrapers/maven";
import { handleNuGet } from "$c/web/scrapers/nuget";
import { handlePackagist } from "$c/web/scrapers/packagist";
import { handleRubyGems } from "$c/web/scrapers/rubygems";

const SKIP = !process.env.WEB_FETCH_INTEGRATION;

describe.skipIf(SKIP)("handleBrew", () => {
	it("returns null for non-Homebrew URLs", async () => {
		const result = await handleBrew("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-package Homebrew URLs", async () => {
		const result = await handleBrew("https://formulae.brew.sh/", 20);
		expect(result).toBeNull();
	});

	it("fetches wget formula", async () => {
		const result = await handleBrew("https://formulae.brew.sh/formula/wget", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("brew");
		expect(result?.content).toContain("wget");
		expect(result?.content).toContain("brew install wget");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});

	it("fetches firefox cask", async () => {
		const result = await handleBrew("https://formulae.brew.sh/cask/firefox", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("brew");
		expect(result?.content).toContain("Firefox");
		expect(result?.content).toContain("brew install --cask firefox");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});
});

describe.skipIf(SKIP)("handleAur", () => {
	it("returns null for non-AUR URLs", async () => {
		const result = await handleAur("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-package AUR URLs", async () => {
		const result = await handleAur("https://aur.archlinux.org/", 20);
		expect(result).toBeNull();
	});

	it("fetches yay package", async () => {
		const result = await handleAur("https://aur.archlinux.org/packages/yay", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("aur");
		expect(result?.content).toContain("yay");
		expect(result?.content).toContain("AUR helper");
		expect(result?.content).toContain("yay -S yay");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});
});

describe.skipIf(SKIP)("handleRubyGems", () => {
	it("returns null for non-RubyGems URLs", async () => {
		const result = await handleRubyGems("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-gem RubyGems URLs", async () => {
		const result = await handleRubyGems("https://rubygems.org/", 20);
		expect(result).toBeNull();
	});

	it("fetches rails gem", async () => {
		const result = await handleRubyGems("https://rubygems.org/gems/rails", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("rubygems");
		expect(result?.content).toContain("rails");
		expect(result?.content).toContain("Total Downloads");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});
});

describe.skipIf(SKIP)("handleNuGet", () => {
	it("returns null for non-NuGet URLs", async () => {
		const result = await handleNuGet("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-package NuGet URLs", async () => {
		const result = await handleNuGet("https://www.nuget.org/", 20);
		expect(result).toBeNull();
	});

	it("fetches Newtonsoft.Json package", async () => {
		const result = await handleNuGet("https://www.nuget.org/packages/Newtonsoft.Json", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("nuget");
		expect(result?.content).toContain("Newtonsoft.Json");
		expect(result?.content).toContain("JSON");
		expect(result?.content).toContain("Total Downloads");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});
});

describe.skipIf(SKIP)("handlePackagist", () => {
	it("returns null for non-Packagist URLs", async () => {
		const result = await handlePackagist("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-package Packagist URLs", async () => {
		const result = await handlePackagist("https://packagist.org/", 20);
		expect(result).toBeNull();
	});

	it("fetches laravel/framework package", async () => {
		const result = await handlePackagist("https://packagist.org/packages/laravel/framework", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("packagist");
		expect(result?.content).toContain("laravel/framework");
		expect(result?.content).toContain("Downloads");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});
});

describe.skipIf(SKIP)("handleMaven", () => {
	it("returns null for non-Maven URLs", async () => {
		const result = await handleMaven("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-artifact Maven URLs", async () => {
		const result = await handleMaven("https://search.maven.org/", 20);
		expect(result).toBeNull();
	});

	it("fetches commons-lang3 artifact from search.maven.org", async () => {
		const result = await handleMaven("https://search.maven.org/artifact/org.apache.commons/commons-lang3", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("maven");
		expect(result?.content).toContain("org.apache.commons");
		expect(result?.content).toContain("commons-lang3");
		expect(result?.content).toContain("<groupId>");
		expect(result?.content).toContain("implementation");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});

	it("fetches commons-lang3 artifact from mvnrepository.com", async () => {
		const result = await handleMaven("https://mvnrepository.com/artifact/org.apache.commons/commons-lang3", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("maven");
		expect(result?.content).toContain("org.apache.commons");
		expect(result?.content).toContain("commons-lang3");
		expect(result?.contentType).toBe("text/markdown");
	});
});
