import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * `context7-mcp` is a vendored bigpowers skill whose two hard gates only hold if the
 * files they name exist here: the cache helper it shells out to before every fetch,
 * and the third-party license its frontmatter points at. Nothing type-checks a
 * markdown skill, so this suite (run under `check:constitution`) pins that shape.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillDir = join(repoRoot, ".omk/skills/context7-mcp");
const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill);

describe("context7-mcp skill frontmatter", () => {
	it("declares the name the catalog and MCP preset refer to", () => {
		assert.ok(frontmatter, "SKILL.md must open with a frontmatter block");
		assert.match(frontmatter[1], /^name: context7-mcp$/m);
	});

	it("carries a description long enough to be selected for real tasks", () => {
		const description = /^description: (.+)$/m.exec(frontmatter[1]);
		assert.ok(description, "frontmatter must declare a description");
		assert.ok(description[1].length > 80, "a one-line description will not match real tasks");
		assert.match(description[1], /Context7/);
	});

	it("points its license field at a bundled MIT license file", () => {
		const license = /^license: (\S+)$/m.exec(frontmatter[1]);
		assert.ok(license, "frontmatter must declare a license file");
		const licenseText = readFileSync(join(skillDir, license[1]), "utf8");
		assert.match(licenseText, /\bMIT License\b/);
		assert.match(licenseText, /Daniel VM/);
	});
});

describe("context7-mcp skill provenance", () => {
	const provenance = /<!--\s*OMK-PROVENANCE([\s\S]*?)-->/.exec(skill);

	it("records the upstream source, pin, and license", () => {
		assert.ok(provenance, "SKILL.md must carry an <!-- OMK-PROVENANCE --> block");
		assert.match(provenance[1], /source:\s*https:\/\/github\.com\/danielvm-git\/bigpowers/);
		assert.match(provenance[1], /pinned-commit:\s*[0-9a-f]{40}/);
		assert.match(provenance[1], /license:\s*MIT/);
	});

	it("explains the fallback delta, since the upstream `bts docs` CLI is not shipped here", () => {
		assert.match(provenance[1], /bts docs/);
		assert.doesNotMatch(skill.slice(provenance.index + provenance[0].length), /\bbts docs\b/);
	});
});

describe("context7-mcp skill gates", () => {
	it("caps Context7 calls and names the explicit unavailable block", () => {
		assert.match(skill, /Max \*\*3\*\* Context7 tool calls/);
		assert.match(skill, /^CONTEXT7_UNAVAILABLE$/m);
		assert.match(skill, /UNVERIFIED/);
	});

	it("routes every fetch through the cache helper with the documented subcommands", () => {
		for (const subcommand of ["get", "put", "etag", "touch", "purge"]) {
			assert.match(
				skill,
				new RegExp(`scripts/lib/doc-fetch-cache\\.sh ${subcommand}\\b`),
				`skill should document the ${subcommand} subcommand`,
			);
		}
		assert.match(skill, /DOC_CACHE_TTL/);
	});

	it("verifies against a helper that actually exists in the repository", () => {
		const verify = /→ verify: `test -f ([^`]+)`/.exec(skill);
		assert.ok(verify, "skill must keep its verify line");
		assert.ok(existsSync(join(repoRoot, verify[1])), `${verify[1]} must exist for the verify gate to pass`);
	});
});

describe("context7-mcp catalog entry", () => {
	it("is listed in the public skill catalog with its license notice", () => {
		const catalog = readFileSync(join(repoRoot, "SKILLS.md"), "utf8");
		assert.match(catalog, /\[`context7-mcp`\]\(\.omk\/skills\/context7-mcp\/SKILL\.md\)/);
		assert.match(catalog, /\[`context7-mcp`\]\(\.omk\/skills\/context7-mcp\/LICENSE-THIRD-PARTY\)/);
	});
});
