import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Hardens the Goal 012 external-skill vendoring decisions (Goal 013): the sanitized
// `clone-website` skill and the six pure-markdown `ponytail*` skills must keep their
// provenance/license/frontmatter shape and stay free of runtime files, Strix/slides-grab
// integration must never be vendored under `.omk/skills`, and `scripts/check-pinned-deps.mjs`
// must keep excluding only the narrow OMK scratch trees, never `.omk` in bulk (that would also
// hide `.omk/skills` from dependency checks). This script only reads local files with node:fs;
// it never executes, imports, or evaluates any vendored skill content or third-party code.

const skillsRoot = ".omk/skills";
const ponytailSkillNames = [
	"ponytail",
	"ponytail-review",
	"ponytail-audit",
	"ponytail-debt",
	"ponytail-gain",
	"ponytail-help",
];
const blockedNamePattern = /\bstrix\b/i;
const blockedSlidesGrabPattern = /\bslides[-_]?grab\b/i;

const failures = [];

function fail(message) {
	failures.push(message);
}

function listEntries(directory) {
	return existsSync(directory) ? readdirSync(directory, { withFileTypes: true }) : [];
}

// Minimal, dependency-free frontmatter split: no YAML library, no eval of skill content.
function readSkillFrontmatter(path) {
	const content = readFileSync(path, "utf8");
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
	return match ? { raw: match[1], body: match[2] } : null;
}

function frontmatterValue(raw, key) {
	const match = new RegExp(`^[ \\t]*${key}:[ \\t]*(.*)$`, "m").exec(raw);
	if (!match) return null;
	return match[1].trim().replace(/^["']|["']$/g, "");
}

function frontmatterHasDescription(raw) {
	const match = /^description:(.*)$/m.exec(raw);
	if (!match) return false;
	const inline = match[1].trim();
	if (inline && !/^[|>][+-]?$/.test(inline)) return true;
	for (const line of raw.slice(match.index + match[0].length).split("\n")) {
		if (line.trim() === "") continue;
		return /^[ \t]/.test(line);
	}
	return false;
}

function assertOnlyFiles(directory, allowedNames, label) {
	for (const entry of listEntries(directory)) {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			fail(`${label}: unexpected subdirectory ${entryPath} (vendored skill must stay flat markdown/license files)`);
		} else if (entry.isSymbolicLink()) {
			fail(`${label}: unexpected symlink ${entryPath} (vendored skill files must be regular files)`);
		} else if (!entry.isFile()) {
			fail(`${label}: unexpected non-regular filesystem entry ${entryPath}`);
		} else if (!allowedNames.has(entry.name)) {
			fail(`${label}: unexpected file ${entryPath} (only ${[...allowedNames].sort().join(", ")} allowed)`);
		}
	}
}

function checkLicenseFile(directory, license, label) {
	if (!license) {
		fail(`${label}: frontmatter is missing a license field`);
		return null;
	}
	if (license.includes("/") || license.includes("\\") || license.includes("..")) {
		fail(`${label}: frontmatter license "${license}" must be a plain filename in the same directory`);
		return null;
	}
	const licensePath = join(directory, license);
	if (!existsSync(licensePath)) {
		fail(`${label}: frontmatter license "${license}" does not reference a file present in ${directory}`);
		return null;
	}
	if (readFileSync(licensePath, "utf8").trim().length === 0) {
		fail(`${label}: license file ${licensePath} is empty`);
	}
	return license;
}

function checkCloneWebsiteSkill() {
	const label = "clone-website";
	const directory = join(skillsRoot, "clone-website");
	if (!existsSync(directory)) {
		fail(`${label}: missing vendored skill directory ${directory}`);
		return;
	}

	const skillPath = join(directory, "SKILL.md");
	if (!existsSync(skillPath)) {
		fail(`${label}: missing ${skillPath}`);
		return;
	}

	const parsed = readSkillFrontmatter(skillPath);
	if (!parsed) {
		fail(`${label}: ${skillPath} has no valid frontmatter block`);
		return;
	}
	const { raw, body } = parsed;

	const name = frontmatterValue(raw, "name");
	if (name !== "clone-website") fail(`${label}: frontmatter name must be "clone-website", found ${JSON.stringify(name)}`);
	if (!frontmatterHasDescription(raw)) fail(`${label}: frontmatter description is missing or empty`);

	const license = checkLicenseFile(directory, frontmatterValue(raw, "license"), label);

	const provenanceMatch = /<!--\s*OMK-PROVENANCE([\s\S]*?)-->/.exec(body);
	if (!provenanceMatch) {
		fail(`${label}: SKILL.md body is missing an <!-- OMK-PROVENANCE ... --> block`);
	} else {
		const provenance = provenanceMatch[1];
		if (!/source:\s*https?:\/\/\S+/.test(provenance)) fail(`${label}: OMK-PROVENANCE block is missing a source URL`);
		if (!/pinned-commit:\s*[0-9a-f]{7,40}/i.test(provenance)) fail(`${label}: OMK-PROVENANCE block is missing a pinned-commit hash`);
		if (!/license:\s*\S+/.test(provenance)) fail(`${label}: OMK-PROVENANCE block is missing a license statement`);
	}

	assertOnlyFiles(directory, new Set(["SKILL.md", license].filter(Boolean)), label);
}

function checkPonytailSkills() {
	const ponytailLike = listEntries(skillsRoot)
		.filter((entry) => entry.isDirectory() && /^ponytail/i.test(entry.name))
		.map((entry) => entry.name)
		.sort();

	const unexpected = ponytailLike.filter((name) => !ponytailSkillNames.includes(name));
	const missing = ponytailSkillNames.filter((name) => !ponytailLike.includes(name));
	if (unexpected.length > 0) {
		fail(
			`ponytail: unexpected vendored ponytail* directories: ${unexpected.join(", ")} (only the six approved skills are allowed)`,
		);
	}
	if (missing.length > 0) {
		fail(`ponytail: missing expected vendored skill directories: ${missing.join(", ")}`);
	}

	const vendoredCommits = new Set();

	for (const name of ponytailSkillNames) {
		const directory = join(skillsRoot, name);
		const label = `ponytail (${name})`;
		if (!existsSync(directory)) continue;

		const skillPath = join(directory, "SKILL.md");
		if (!existsSync(skillPath)) {
			fail(`${label}: missing ${skillPath}`);
			continue;
		}

		const parsed = readSkillFrontmatter(skillPath);
		if (!parsed) {
			fail(`${label}: ${skillPath} has no valid frontmatter block`);
			continue;
		}
		const { raw, body } = parsed;

		const frontmatterName = frontmatterValue(raw, "name");
		if (frontmatterName !== name) {
			fail(`${label}: frontmatter name must be "${name}", found ${JSON.stringify(frontmatterName)}`);
		}
		if (!frontmatterHasDescription(raw)) fail(`${label}: frontmatter description is missing or empty`);

		const license = frontmatterValue(raw, "license");
		if (license !== "MIT") fail(`${label}: frontmatter license must be "MIT", found ${JSON.stringify(license)}`);

		const vendoredFrom = frontmatterValue(raw, "vendored-from");
		const vendoredCommit = frontmatterValue(raw, "vendored-commit");
		if (!vendoredFrom || !/^https?:\/\//.test(vendoredFrom)) {
			fail(`${label}: frontmatter metadata.vendored-from must be a URL`);
		}
		if (!vendoredCommit || !/^[0-9a-f]{7,40}$/i.test(vendoredCommit)) {
			fail(`${label}: frontmatter metadata.vendored-commit must be a pinned commit hash`);
		} else {
			vendoredCommits.add(vendoredCommit);
		}

		if (!/^##\s+OMK Vendoring Notice/m.test(body)) {
			fail(`${label}: body is missing the "## OMK Vendoring Notice" section`);
		}

		const allowedFiles = new Set(["SKILL.md"]);
		if (name === "ponytail") allowedFiles.add("LICENSE");
		assertOnlyFiles(directory, allowedFiles, label);
	}

	if (vendoredCommits.size > 1) {
		fail(
			`ponytail: vendored-commit values are inconsistent across skills (${[...vendoredCommits].join(", ")}); all six must be pinned to the same upstream commit`,
		);
	}

	const licensePath = join(skillsRoot, "ponytail", "LICENSE");
	if (existsSync(licensePath) && !/\bMIT\b/i.test(readFileSync(licensePath, "utf8"))) {
		fail(`ponytail: ${licensePath} does not look like an MIT license file`);
	}
}

function checkNoBlockedVendoredSkills() {
	function walk(directory) {
		for (const entry of listEntries(directory)) {
			const entryPath = join(directory, entry.name);
			if (blockedNamePattern.test(entry.name)) {
				fail(`vendored-skills: blocked "strix" entry found at ${entryPath} (Strix integration was never approved)`);
			}
			if (blockedSlidesGrabPattern.test(entry.name)) {
				fail(
					`vendored-skills: blocked "slides-grab" entry found at ${entryPath} (slides-grab stays a documentation caveat only, never vendored)`,
				);
			}
			if (entry.isDirectory()) {
				walk(entryPath);
			} else if (entry.name === "SKILL.md") {
				const parsed = readSkillFrontmatter(entryPath);
				const name = parsed ? frontmatterValue(parsed.raw, "name") : null;
				if (name && (blockedNamePattern.test(name) || blockedSlidesGrabPattern.test(name))) {
					fail(`vendored-skills: blocked skill name "${name}" declared in ${entryPath}`);
				}
			}
		}
	}

	walk(skillsRoot);
}

function extractSetLiteral(source, constName) {
	const match = new RegExp(`const\\s+${constName}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`).exec(source);
	if (!match) return null;
	return [...match[1].matchAll(/"([^"]*)"|'([^']*)'/g)].map((entry) => entry[1] ?? entry[2]);
}

function checkPinnedDepsIgnoreScope() {
	const label = "check-pinned-deps";
	const scriptPath = "scripts/check-pinned-deps.mjs";
	if (!existsSync(scriptPath)) {
		fail(`${label}: missing ${scriptPath}`);
		return;
	}

	const source = readFileSync(scriptPath, "utf8");
	const directoryNames = extractSetLiteral(source, "ignoredDirectories");
	const directoryPaths = extractSetLiteral(source, "ignoredDirectoryPaths");

	if (!directoryPaths) {
		fail(`${label}: could not find an "ignoredDirectoryPaths" Set literal in ${scriptPath}`);
	} else {
		const required = [".omk/git", ".omk/goals", ".omk/npm"];
		const missing = required.filter((path) => !directoryPaths.includes(path));
		if (missing.length > 0) {
			fail(`${label}: ignoredDirectoryPaths is missing required scratch paths: ${missing.join(", ")}`);
		}
		if (directoryPaths.includes(".omk")) {
			fail(`${label}: ignoredDirectoryPaths must not blanket-ignore ".omk" (it would also hide ".omk/skills")`);
		}
		if (directoryPaths.includes(".omk/skills")) {
			fail(`${label}: ignoredDirectoryPaths must not ignore ".omk/skills" (vendored skill manifests must stay checked)`);
		}
	}

	if (!directoryNames) {
		fail(`${label}: could not find an "ignoredDirectories" Set literal in ${scriptPath}`);
	} else if (directoryNames.includes(".omk")) {
		fail(`${label}: ignoredDirectories must not blanket-ignore ".omk" by name (it would also hide ".omk/skills")`);
	}
}

checkCloneWebsiteSkill();
checkPonytailSkills();
checkNoBlockedVendoredSkills();
checkPinnedDepsIgnoreScope();

if (failures.length > 0) {
	console.error("Vendored skill checks failed:");
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}
