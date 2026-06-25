// Generates the per-domain "inherited document" markdown from the registry so
// the docs always match the code. Run: node --import tsx scripts/gen-domain-docs.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
	DOMAIN_IDS,
	DOMAIN_PROFILES,
	FALLBACK_DOMAIN_ID,
} from "../packages/coding-agent/src/core/domain-loadouts.ts";
import { routeDomain } from "../packages/coding-agent/src/core/domain-router.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "packages", "coding-agent", "docs", "loadout-domains");
mkdirSync(outDir, { recursive: true });

const kinds = (g) => (g?.allow?.[0]?.names ?? []);
const triggerRows = (profile) =>
	profile.triggers
		.map((t) => `| ${t.kind} | \`${t.pattern}\` | ${t.weight} |`)
		.join("\n");

function domainDoc(profile, isFallback) {
	const skills = kinds(profile.skills);
	const mcp = kinds(profile.mcp);
	const hooks = kinds(profile.hooks);
	const tools = profile.tools.allow?.join(", ") ?? "_(none)_";
	const authority = profile.authority;
	const cmd = profile.commands?.mode ?? "_(default)_";
	const tags = `# ${profile.label} (\`${profile.id}\`)\n\n> Inherited domain capability document. Auto-generated from \`src/core/domain-loadouts.ts\` — do not edit by hand.\n\n${isFallback ? "_Fallback profile — selected when no domain clears the weak threshold._\n\n" : ""}`;
	return `${tags}
## Identity

| field | value |
|---|---|
| id | \`${profile.id}\` |
| authority | \`${authority}\` |
| tools | ${tools} |
| command mode | \`${cmd}\` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

\`\`\`text
${profile.routingPrompt}
\`\`\`

## Curated skills (${skills.length})

${skills.map((s) => `- \`${s}\``).join("\n")}

## Curated MCP servers (${mcp.length})

${mcp.map((s) => `- \`${s}\``).join("\n")}

## Curated hooks (${hooks.length})

${hooks.map((s) => `- \`${s}\``).join("\n")}

## Routing triggers (${profile.triggers.length})

| kind | pattern | weight |
|---|---|---|
${triggerRows(profile)}
`;
}

// Per-domain files
for (const id of Object.keys(DOMAIN_PROFILES)) {
	const profile = DOMAIN_PROFILES[id];
	writeFileSync(join(outDir, `${id}.md`), domainDoc(profile, id === FALLBACK_DOMAIN_ID));
}

// Index
const demoTasks = [
	["build a responsive login form with tailwind", ["src/app/page.tsx"]],
	["scan for xss and sql injection vulnerabilities", []],
	["do a literature review on RLHF, cite arxiv", []],
	["write a dockerfile and deploy to vercel", ["Dockerfile"]],
	["fix the failing playwright e2e tests", ["tests/login.test.ts"]],
	["add a postgres migration for the users table", []],
	["train a classifier on the dataset, plot results", ["notebooks/model.ipynb"]],
	["hello there", []],
];
const demoRows = demoTasks
	.map(([task, paths]) => {
		const r = routeDomain({ task, paths });
		return `| \`${task}\` | ${paths.length ? `\`${paths.join(", ")}\`` : "—"} | [\`${r.primary.id}\`](${r.primary.id}.md) | ${r.confidence} | ${r.reason} |`;
	})
	.join("\n");

const index = `# Domain Loadout Router

OMK routes incoming tasks to a **domain capability profile** ("inherited document") before dispatch. Each profile is a curated bundle of skills, MCP servers, hooks, a tool gate, an authority, and a detailed English routing prompt — all selected from the live capability inventory. The router is deterministic, I/O-free, and explainable.

> Auto-generated from \`src/core/domain-loadouts.ts\` + \`src/core/domain-router.ts\`. Regenerate with \`node --import tsx scripts/gen-domain-docs.mjs\`.

## How routing works

1. **Signal extraction.** The task text (plus optional path hints and upstream tags) is lowercased and scored against every domain's triggers.
2. **Weighted multi-signal scoring.**
   - \`keyword\` — literal phrase occurrences (counted, capped at 3) × weight.
   - \`regex\` — intent cluster tested once against the task text × weight.
   - \`extension\` — file suffix on any path hint × weight.
   - \`path\` — path fragment contained in any path hint × weight.
3. **Ranking.** Domains are sorted best-first; ties break by registry order (deterministic).
4. **Confidence.**
   - top score ≥ **8** → \`confident\`
   - **4** ≤ top score < 8 → \`tentative\`
   - top score < 4 (or zero signals) → \`fallback\` to [\`general\`](general.md)
5. **Ambiguity.** When the runner-up is within **2** of a tentative leader, the result is flagged \`ambiguous\` (the leader still wins; the caller can ask for clarification).

Thresholds: \`STRONG_THRESHOLD = 8\`, \`WEAK_THRESHOLD = 4\`, \`AMBIGUITY_MARGIN = 2\`.

## Domains (${DOMAIN_IDS.length} + 1 fallback)

${DOMAIN_IDS.map((id) => `- [\`${id}\`](${id}.md) — ${DOMAIN_PROFILES[id].label}`).join("\n")}
- [\`${FALLBACK_DOMAIN_ID}\`](${FALLBACK_DOMAIN_ID}.md) — ${DOMAIN_PROFILES[FALLBACK_DOMAIN_ID].label}

## Worked examples

| task | path hints | routed to | confidence | reason |
|---|---|---|---|---|
${demoRows}

## Composition with role loadouts

A domain profile is a \`LoadoutProfile\`, so it composes with the existing role-based system (\`BUILTIN_LOADOUTS\`: inspect / plan / code / test / review / security / package-maintainer). The domain gates **which** skills/MCP/hooks are active; the role sets authority/tools/commands. Use \`domainLoadoutProfiles()\` to get plain profiles consumable by \`applyLoadoutProfile()\`.

## API

\`\`\`ts
import { routeDomain } from "./core/domain-router.ts";
const result = routeDomain({ task: "build a login form", paths: ["page.tsx"] });
// result.primary   -> DomainProfile
// result.confidence -> "confident" | "tentative" | "fallback"
// result.scores    -> ranked DomainScore[] with matchedSignals
// result.ambiguous -> boolean
\`\`\`

## Adding a domain

1. Add a new entry to \`DOMAIN_PROFILES\` in \`src/core/domain-loadouts.ts\` (id, label, authority, tools, curated skills/mcp/hooks, triggers, routingPrompt).
2. The router and docs pick it up automatically — no other code changes.
3. Run \`npm run check\` (biome + tsgo + tests) and regenerate docs.
`;

writeFileSync(join(outDir, "README.md"), index);
console.log(`Wrote ${Object.keys(DOMAIN_PROFILES).length + 1} files to ${outDir}`);
