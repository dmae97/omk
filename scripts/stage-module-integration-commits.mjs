#!/usr/bin/env node
/**
 * Stages module-integration-2026-07-07 commits C1/C2/C3 per algorithm-commit-discipline-v2.
 * Default: dry-run (prints git commands only). Use --execute to run restore + add for one group.
 * Never runs git commit. Never uses git add -A.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @type {Record<string, { label: string; title: string; paths: string[]; addArgs: string[] }>} */
const GROUPS = {
	c1: {
		label: "C1",
		title: "vendor: design-taste + caveman skills (hash-pinned)",
		paths: [
			".omk/skills/taste-skill/",
			".omk/skills/caveman/",
			"scripts/check-vendored-skills.mjs",
		],
		addArgs: [
			"-f",
			".omk/skills/taste-skill/",
			".omk/skills/caveman/",
			"scripts/check-vendored-skills.mjs",
		],
	},
	c2: {
		label: "C2",
		title: "feat: DOMAIN_PROFILES frontend-ui gate for taste-skill",
		paths: [
			"packages/coding-agent/src/core/domain-loadouts.ts",
			"packages/coding-agent/test/domain-loadouts.test.ts",
			"packages/coding-agent/test/suite/regressions/external-pack-integration-acceptance.test.ts",
		],
		addArgs: [
			"packages/coding-agent/src/core/domain-loadouts.ts",
			"packages/coding-agent/test/domain-loadouts.test.ts",
			"packages/coding-agent/test/suite/regressions/external-pack-integration-acceptance.test.ts",
		],
	},
	c3: {
		label: "C3",
		title: "feat(codexbar): opt-in quota adapter + omk quota CLI",
		paths: [
			"packages/coding-agent/src/core/codexbar-adapter.ts",
			"packages/coding-agent/src/codexbar-cli.ts",
			"packages/coding-agent/src/utils/tools-manager.ts",
			"packages/coding-agent/src/main.ts",
			"packages/coding-agent/src/cli/args.ts",
			"packages/coding-agent/test/suite/codexbar-adapter.test.ts",
			"packages/coding-agent/test/suite/codexbar-cli.test.ts",
			"packages/coding-agent/test/suite/tools-manager-codexbar.test.ts",
		],
		addArgs: [
			"packages/coding-agent/src/core/codexbar-adapter.ts",
			"packages/coding-agent/src/utils/tools-manager.ts",
			"packages/coding-agent/src/codexbar-cli.ts",
			"packages/coding-agent/src/main.ts",
			"packages/coding-agent/src/cli/args.ts",
			"packages/coding-agent/test/suite/codexbar-adapter.test.ts",
			"packages/coding-agent/test/suite/codexbar-cli.test.ts",
			"packages/coding-agent/test/suite/tools-manager-codexbar.test.ts",
		],
	},
};

const FOREIGN_MUST_STAY_OUT = [
	"packages/coding-agent/CHANGELOG.md",
	"packages/coding-agent/src/core/reasoning-router-v4-weights.ts",
	"packages/coding-agent/src/core/reasoning-router-v4.ts",
	"packages/coding-agent/test/suite/regressions/016-reasoning-router-v4-generalization.test.ts",
	"packages/coding-agent/scripts/reasoning-router/calibration.ts",
	"packages/coding-agent/src/core/reasoning-router-v4-normalize.ts",
	"packages/coding-agent/test/fixtures/reasoning-router-generalization-set.ts",
	"packages/coding-agent/test/suite/regressions/017-reasoning-router-v4-generalization-governance.test.ts",
];

function usage() {
	console.error(`Usage: node scripts/stage-module-integration-commits.mjs [options]

Options:
  --group c1|c2|c3|c1,c2,c3   Stage one or more groups (default: all)
  --dry-run                   Print git commands only (default)
  --no-dry-run                Alias for --execute
  --execute                   Run git restore --staged + git add for selected group(s)

Never runs git commit. Never uses git add -A.
Ref: .omk/goals/module-integration-2026-07-07/algorithm-commit-discipline-v2.md`);
}

/** @param {string[]} argv */
function parseArgs(argv) {
	let dryRun = true;
	/** @type {string[]} */
	let groups = ["c1", "c2", "c3"];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			usage();
			process.exit(0);
		}
		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (arg === "--execute" || arg === "--no-dry-run") {
			dryRun = false;
			continue;
		}
		if (arg === "--group") {
			const value = argv[++i];
			if (!value) {
				console.error("Missing value for --group");
				process.exit(2);
			}
			groups = value
				.split(",")
				.map((g) => g.trim().toLowerCase())
				.filter(Boolean);
			continue;
		}
		console.error(`Unknown argument: ${arg}`);
		usage();
		process.exit(2);
	}

	for (const g of groups) {
		if (!GROUPS[g]) {
			console.error(`Unknown group: ${g}. Expected c1, c2, or c3.`);
			process.exit(2);
		}
	}

	return { dryRun, groups };
}

/** @param {string} cmd @param {string[]} args */
function formatGitLine(cmd, args) {
	const quoted = args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a));
	return `${cmd} ${quoted.join(" ")}`;
}

/** @param {string[]} args @param {boolean} dryRun */
function runGit(args, dryRun) {
	const line = formatGitLine("git", args);
	if (dryRun) {
		console.log(line);
		return { status: 0, stdout: "", stderr: "" };
	}
	const result = spawnSync("git", args, {
		cwd: REPO_ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function printForeignWarning() {
	console.log("");
	console.log("# WARNING: foreign-session paths must NOT be staged (reasoning-router, CHANGELOG):");
	for (const p of FOREIGN_MUST_STAY_OUT) {
		console.log(`#   ${p}`);
	}
	console.log("# If any appear in the index after staging, run algorithm §4 unstage before commit.");
	console.log("");
}

/** @param {string} key */
function stageGroup(key, dryRun) {
	const group = GROUPS[key];
	console.log(`# --- ${group.label}: ${group.title} ---`);
	console.log("# Rebuild index for this group only (never git add -A):");
	const restoreResult = runGit(["restore", "--staged", "."], dryRun);
	if (dryRun) {
		console.log("# (if restore --staged . fails: git reset)");
	} else if (restoreResult.status !== 0) {
		console.log("# git restore --staged . failed; falling back to git reset");
		runGit(["reset"], dryRun);
	}
	const addArgs = ["add", ...group.addArgs];
	runGit(addArgs, dryRun);
	console.log("# Expected staged paths:");
	for (const p of group.paths) {
		console.log(`#   ${p}`);
	}
	console.log("");
}

function main() {
	const { dryRun, groups } = parseArgs(process.argv.slice(2));

	console.log(`# repo: ${REPO_ROOT}`);
	console.log(`# mode: ${dryRun ? "dry-run (commands only)" : "execute (will modify index)"}`);
	console.log(`# groups: ${groups.join(", ")}`);
	console.log("");

	if (!dryRun) {
		if (groups.length > 1) {
			console.error(
				"WARNING: --execute with multiple --group values runs restore+add per group; only the LAST group's paths remain staged.",
			);
			console.error("Prefer: --execute --group c1 (one commit group at a time).");
		}
		printForeignWarning();
		console.error(
			"WARNING: --execute will unstage entire index then stage only the selected group(s).",
		);
		console.error(
			"WARNING: Do not include foreign paths (reasoning-router, CHANGELOG) — verify with git diff --cached --name-only",
		);
		console.error("");
	}

	for (const key of groups) {
		stageGroup(key, dryRun);
	}

	if (dryRun) {
		printForeignWarning();
		console.log("# Next: run with --execute --group <c1|c2|c3> after review (still no git commit).");
	} else {
		const stat = runGit(["diff", "--cached", "--name-only"], false);
		if (stat.status === 0 && stat.stdout.trim()) {
			console.log("Staged paths after execute:");
			console.log(stat.stdout.trim());
		}
	}
}

main();