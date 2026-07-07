#!/usr/bin/env node
// Deterministic capability router CLI.
//
// Two read-only modes:
//   classify <name> [description...]   Classify one agent; print domain + derived skills/mcp/hooks.
//   audit [--json] [--agent-dir <p>]   Scan all agents; report declared-vs-derived drift.
//
// The deterministic router is a baseline / drift detector only. It never writes
// files: overwriting the ~233 broad-catalog agents' LLM-precision assignments
// with a keyword voter would destroy curated data. There is intentionally no
// `apply` mode.
//
// Depends on the typechecked router/catalog modules (Node >= 22.19 strip-types):
//   packages/coding-agent/examples/extensions/subagent/agent-capability-router.ts
//   packages/coding-agent/examples/extensions/subagent/capabilities.ts

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	classifyAgent,
	deriveCapabilities,
	auditCapabilities,
} from "/home/yu/omk/packages/coding-agent/examples/extensions/subagent/agent-capability-router.ts";
import {
	buildCapabilityCatalog,
	parseEmbeddedCapabilities,
} from "/home/yu/omk/packages/coding-agent/examples/extensions/subagent/capabilities.ts";

/** Where agent .md files live by default. */
const DEFAULT_AGENTS_MD_DIR = path.join(os.homedir(), ".omk", "agent", "agents");
/** Exact basenames (minus .md) excluded from the audit scan (OMK-native lanes). */
const EXCLUDE_BASENAMES = new Set(["planner", "reviewer", "scout", "worker"]);
/** Basename prefixes excluded from the audit scan. */
const EXCLUDE_PREFIXES = ["omk-", "ua-"];
/** Number of drift/divergent samples to print in the text audit report. */
const SAMPLE_LIMIT = 10;

function usage(stream = process.stdout) {
	stream.write(
		[
			"Usage:",
			"  node scripts/derive-agent-capabilities.mjs classify <name> [description...]",
			"  node scripts/derive-agent-capabilities.mjs audit [--json] [--agent-dir <path>]",
			"",
			"Modes:",
			"  classify   Classify a single agent; print domain + derived skills/mcp/hooks.",
			"  audit      Scan all agents; report declared-vs-derived drift (read-only).",
			"",
			"Options:",
			"  --agent-dir <path>  Override the scanned .md directory.",
			"  --json              (audit) Emit the report as JSON.",
			"",
			"Env:",
			"  AGENT_DIR  Override the scanned .md directory (default ~/.omk/agent/agents).",
			"             The catalog is built from its parent (which holds skills/, omk-ui/, ...).",
			"",
		].join("\n"),
	);
}

/** Strip one layer of surrounding single/double quotes. */
function stripQuotes(value) {
	const len = value.length;
	if (len >= 2) {
		const first = value[0];
		const last = value[len - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return value.slice(1, -1).trim();
		}
	}
	return value;
}

/** Extract the top-level YAML frontmatter block (between `---` fences). */
function extractFrontmatter(text) {
	const m = text.match(/^---\s*\n([\s\S]*?)\n(?:---|\.\.\.)\s*(?:\n|$)/);
	return m ? m[1] : "";
}

/** Pull the `description:` value from the frontmatter (single-line). */
function extractDescription(text) {
	const fm = extractFrontmatter(text);
	if (!fm) return "";
	for (const line of fm.split("\n")) {
		const m = line.match(/^description:\s*(.+)$/);
		if (m) return stripQuotes(m[1]).trim();
	}
	return "";
}

/** OMK-native lanes and understand-anything agents are excluded from the audit. */
function isExcluded(filename) {
	const base = filename.replace(/\.md$/, "");
	if (EXCLUDE_BASENAMES.has(base)) return true;
	return EXCLUDE_PREFIXES.some((p) => base.startsWith(p));
}

/**
 * Resolve the .md scan dir and the catalog dir.
 * `--agent-dir` wins, then AGENT_DIR env, then the default. The catalog is
 * built from the parent of the .md dir, since buildCapabilityCatalog scans
 * `<agentDir>/skills`, `<agentDir>/omk-ui`, etc.
 */
function resolveDirs(argv) {
	let mdDir = process.env.AGENT_DIR || DEFAULT_AGENTS_MD_DIR;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--agent-dir" && i + 1 < argv.length) mdDir = argv[++i];
	}
	const catalogDir = path.dirname(path.resolve(mdDir));
	return { mdDir, catalogDir };
}

/** Build the catalog once, with a friendly error if the dir is missing. */
function buildCatalog(catalogDir) {
	try {
		return buildCapabilityCatalog({ agentDir: catalogDir });
	} catch (err) {
		process.stderr.write(`Error building capability catalog from ${catalogDir}: ${err.message}\n`);
		process.exit(1);
	}
}

function cmdClassify(argv) {
	const positional = argv.filter((a) => !a.startsWith("--"));
	if (positional.length === 0) {
		process.stderr.write("Error: classify requires a <name> argument.\n\n");
		usage(process.stderr);
		process.exit(2);
	}
	const name = positional[0];
	const description = positional.slice(1).join(" ");
	const { catalogDir } = resolveDirs(argv);
	const catalog = buildCatalog(catalogDir);

	const domain = classifyAgent(name, description);
	const derived = deriveCapabilities(name, description, catalog);

	console.log(`name: ${name}`);
	console.log(`description: ${description || "(none)"}`);
	if (domain === null) {
		console.log("domain: (none — no direct OMK skill match)");
	} else {
		console.log(`domain: ${domain.id} — ${domain.label}`);
	}
	console.log(`derived skills: ${derived.skills.length ? derived.skills.join(", ") : "(none)"}`);
	console.log(`derived mcp: ${derived.mcp.length ? derived.mcp.join(", ") : "(none)"}`);
	console.log(`derived hooks: ${derived.hooks.length ? derived.hooks.join(", ") : "(none)"}`);
}

function cmdAudit(argv) {
	const asJson = argv.includes("--json");
	const { mdDir, catalogDir } = resolveDirs(argv);
	if (!fs.existsSync(mdDir) || !fs.statSync(mdDir).isDirectory()) {
		process.stderr.write(`Error: agent dir not found: ${mdDir}\n`);
		process.exit(1);
	}
	const catalog = buildCatalog(catalogDir);
	const files = fs
		.readdirSync(mdDir)
		.filter((f) => f.endsWith(".md") && !isExcluded(f))
		.sort();

	const stats = {
		total: files.length,
		classified: 0,
		nullDomain: 0,
		withDeclared: 0,
		verdict: { match: 0, drift: 0, divergent: 0 },
		unknownFiles: [],
		samples: [],
	};

	for (const f of files) {
		let text;
		try {
			text = fs.readFileSync(path.join(mdDir, f), "utf8");
		} catch {
			continue;
		}
		const name = f.replace(/\.md$/, "");
		const description = extractDescription(text);
		const declared = parseEmbeddedCapabilities(text);
		const derived = deriveCapabilities(name, description, catalog);
		const domain = classifyAgent(name, description);

		if (domain === null) stats.nullDomain++;
		else stats.classified++;

		if (declared !== undefined) {
			stats.withDeclared++;
			const a = auditCapabilities(declared, derived, catalog);
			stats.verdict[a.verdict]++;
			if (a.declaredUnknownSkills.length > 0) {
				stats.unknownFiles.push({ file: f, skills: [...a.declaredUnknownSkills] });
			}
			if (a.verdict !== "match") {
				stats.samples.push({
					name,
					domain: domain ? domain.id : "(none)",
					jaccard: a.jaccard,
					declaredTop3: [...declared.skills.slice(0, 3)],
					derivedTop3: [...derived.skills.slice(0, 3)],
				});
			}
		}
	}

	// Worst (lowest jaccard) first.
	stats.samples.sort((x, y) => x.jaccard - y.jaccard);

	if (asJson) {
		console.log(
			JSON.stringify(
				{
					agentDir: mdDir,
					catalogDir,
					catalogSkills: catalog.skills.size,
					catalogMcp: catalog.mcp.size,
					catalogHooks: catalog.hooks.size,
					total: stats.total,
					classified: stats.classified,
					nullDomain: stats.nullDomain,
					withDeclared: stats.withDeclared,
					verdict: stats.verdict,
					unknownFileCount: stats.unknownFiles.length,
					unknownFiles: stats.unknownFiles,
					samples: stats.samples.slice(0, SAMPLE_LIMIT),
				},
				null,
				2,
			),
		);
		return;
	}

	console.log(`Agent dir: ${mdDir}`);
	console.log(
		`Catalog: ${catalog.skills.size} skills, ${catalog.mcp.size} mcp, ${catalog.hooks.size} hooks (from ${catalogDir})`,
	);
	console.log(`Scanned: ${stats.total} files`);
	console.log(`Classified: ${stats.classified}  |  null domain: ${stats.nullDomain}`);
	console.log(`With declared capabilities: ${stats.withDeclared}`);
	console.log(
		`Verdict (over declared): match=${stats.verdict.match} drift=${stats.verdict.drift} divergent=${stats.verdict.divergent}`,
	);
	console.log(`Files with unknown declared skills: ${stats.unknownFiles.length}`);

	if (stats.unknownFiles.length > 0) {
		console.log("\nUNKNOWN (declared skill not in live catalog — bug):");
		for (const { file, skills } of stats.unknownFiles) {
			console.log(`  ${file}: ${skills.join(", ")}`);
		}
	}

	if (stats.samples.length > 0) {
		console.log(`\nDrift/divergent samples (worst first, top ${SAMPLE_LIMIT}):`);
		for (const s of stats.samples.slice(0, SAMPLE_LIMIT)) {
			console.log(`  ${s.name} [${s.domain}] jaccard=${s.jaccard.toFixed(3)}`);
			console.log(`    declared: ${s.declaredTop3.join(", ") || "(none)"}`);
			console.log(`    derived:  ${s.derivedTop3.join(", ") || "(none)"}`);
		}
	}
}

function main() {
	const argv = process.argv.slice(2);
	if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
		usage();
		process.exit(argv.length === 0 ? 2 : 0);
	}
	const cmd = argv[0];
	const rest = argv.slice(1);
	if (cmd === "classify") cmdClassify(rest);
	else if (cmd === "audit") cmdAudit(rest);
	else {
		process.stderr.write(`Error: unknown command '${cmd}'\n\n`);
		usage(process.stderr);
		process.exit(2);
	}
}

main();
