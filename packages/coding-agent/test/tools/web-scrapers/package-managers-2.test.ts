import { describe, expect, it } from "bun:test";
import { handleChocolatey } from "$c/web/scrapers/chocolatey";
import { handleDockerHub } from "$c/web/scrapers/dockerhub";
import { handleHackage } from "$c/web/scrapers/hackage";
import { handleMetaCPAN } from "$c/web/scrapers/metacpan";
import { handleRepology } from "$c/web/scrapers/repology";
import { handleTerraform } from "$c/web/scrapers/terraform";

const SKIP = !process.env.WEB_FETCH_INTEGRATION;

describe.skipIf(SKIP)("handleMetaCPAN", () => {
	it("returns null for non-MetaCPAN URLs", async () => {
		const result = await handleMetaCPAN("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-matching MetaCPAN paths", async () => {
		const result = await handleMetaCPAN("https://metacpan.org/about", 20);
		expect(result).toBeNull();
	});

	it("fetches Moose module", async () => {
		const result = await handleMetaCPAN("https://metacpan.org/pod/Moose", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("metacpan");
		expect(result?.content).toContain("Moose");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});

	it("fetches release by distribution name", async () => {
		const result = await handleMetaCPAN("https://metacpan.org/release/Moose", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("metacpan");
		expect(result?.content).toContain("Moose");
	});
});

describe.skipIf(SKIP)("handleHackage", () => {
	it("returns null for non-Hackage URLs", async () => {
		const result = await handleHackage("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-package Hackage paths", async () => {
		const result = await handleHackage("https://hackage.haskell.org/", 20);
		expect(result).toBeNull();
	});

	it("fetches aeson package", async () => {
		const result = await handleHackage("https://hackage.haskell.org/package/aeson", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("hackage");
		expect(result?.content).toContain("aeson");
		expect(result?.content).toContain("JSON");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});

	it("fetches text package", async () => {
		const result = await handleHackage("https://hackage.haskell.org/package/text", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("hackage");
		expect(result?.content).toContain("text");
	});
});

describe.skipIf(SKIP)("handleDockerHub", () => {
	it("returns null for non-DockerHub URLs", async () => {
		const result = await handleDockerHub("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-matching DockerHub paths", async () => {
		const result = await handleDockerHub("https://hub.docker.com/search", 20);
		expect(result).toBeNull();
	});

	it("fetches official nginx image", async () => {
		const result = await handleDockerHub("https://hub.docker.com/_/nginx", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("dockerhub");
		expect(result?.content).toContain("nginx");
		expect(result?.content).toContain("docker pull");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});

	it("fetches grafana/grafana image", async () => {
		const result = await handleDockerHub("https://hub.docker.com/r/grafana/grafana", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("dockerhub");
		expect(result?.content).toContain("grafana");
		expect(result?.content).toContain("docker pull");
	});
});

describe.skipIf(SKIP)("handleChocolatey", () => {
	it("returns null for non-Chocolatey URLs", async () => {
		const result = await handleChocolatey("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-package Chocolatey paths", async () => {
		const result = await handleChocolatey("https://community.chocolatey.org/", 20);
		expect(result).toBeNull();
	});

	it("fetches git package", async () => {
		const result = await handleChocolatey("https://community.chocolatey.org/packages/git", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("chocolatey");
		expect(result?.content).toContain("Git");
		expect(result?.content).toContain("choco install");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});

	it("fetches nodejs package", async () => {
		const result = await handleChocolatey("https://community.chocolatey.org/packages/nodejs", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("chocolatey");
		expect(result?.content).toContain("Node");
	});
});

describe.skipIf(SKIP)("handleRepology", () => {
	it("returns null for non-Repology URLs", async () => {
		const result = await handleRepology("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-project Repology paths", async () => {
		const result = await handleRepology("https://repology.org/", 20);
		expect(result).toBeNull();
	});

	it("fetches firefox project", async () => {
		const result = await handleRepology("https://repology.org/project/firefox", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("repology");
		expect(result?.content).toContain("firefox");
		expect(result?.content).toContain("Repositories");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});

	it("fetches vim project", async () => {
		const result = await handleRepology("https://repology.org/project/vim/versions", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("repology");
		expect(result?.content).toContain("vim");
	});
});

describe.skipIf(SKIP)("handleTerraform", () => {
	it("returns null for non-Terraform URLs", async () => {
		const result = await handleTerraform("https://example.com", 20);
		expect(result).toBeNull();
	});

	it("returns null for non-matching Terraform paths", async () => {
		const result = await handleTerraform("https://registry.terraform.io/", 20);
		expect(result).toBeNull();
	});

	it("fetches hashicorp/aws provider", async () => {
		const result = await handleTerraform("https://registry.terraform.io/providers/hashicorp/aws", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("terraform");
		expect(result?.content).toContain("aws");
		expect(result?.content).toContain("hashicorp");
		expect(result?.content).toContain("required_providers");
		expect(result?.contentType).toBe("text/markdown");
		expect(result?.fetchedAt).toBeTruthy();
		expect(result?.truncated).toBeDefined();
	});

	it("fetches terraform-aws-modules/vpc/aws module", async () => {
		const result = await handleTerraform("https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("terraform");
		expect(result?.content).toContain("vpc");
		expect(result?.content).toContain("terraform-aws-modules");
		expect(result?.content).toContain("module");
	});

	it("fetches hashicorp/random provider", async () => {
		const result = await handleTerraform("https://registry.terraform.io/providers/hashicorp/random", 20);
		expect(result).not.toBeNull();
		expect(result?.method).toBe("terraform");
		expect(result?.content).toContain("random");
	});
});
