/**
 * Domain capability profiles — domain-aware "inherited documents" for the OMK
 * control plane.
 *
 * OMK ships role-based loadouts (`loadouts.ts`: inspect/plan/code/test/review/
 * security/package-maintainer/none). This module adds an orthogonal, **domain**
 * layer: each domain profile is a curated capability bundle (skills + MCP +
 * hooks + tool gate + authority + command mode) tuned for one class of work,
 * plus a very detailed English `routingPrompt` and deterministic `triggers`
 * used by `domain-router.ts` to pick the right bundle for an incoming task.
 *
 * A `DomainProfile` is a `LoadoutProfile` augmented with routing metadata, so it
 * composes with the existing `applyLoadoutProfile()` runtime: the router selects
 * a domain, the domain profile gates which skills/MCP/hooks are active, and the
 * caller still picks the role authority. This keeps the new layer purely
 * additive — no existing loadout behavior changes.
 *
 * This module is I/O-free and side-effect-free. All resource names (skills,
 * MCP servers, hooks) reference canonical identifiers discovered by
 * `resource-loader.ts`, `mcp-inventory.ts`, and `hook-inventory.ts`.
 *
 * Erasable TypeScript only (no enum/namespace/parameter properties).
 */

import type { CapabilityGate, LoadoutCommands, LoadoutProfile, ToolGate } from "./loadouts.ts";

/** Signal kinds the router evaluates. */
export type TriggerKind = "keyword" | "regex" | "extension" | "path";

/**
 * One routing signal for a domain.
 *
 * - `keyword`: case-insensitive, word-boundary substring of the task text.
 *   Multi-word phrases are matched literally. Matched occurrences are counted
 *   (capped) so repeated mentions raise confidence.
 * - `regex`: matched against the lowercased task text via RegExp. Use for
 *   intent clusters that keywords cannot express compactly (e.g. `cve-\d`).
 * - `extension`: matched against the suffix of any provided path hint.
 * - `path`: glob fragment matched against any provided path hint.
 */
export interface TriggerSpec {
	readonly kind: TriggerKind;
	readonly pattern: string;
	readonly weight: number;
}

/** Domain routing + identity metadata layered on top of a LoadoutProfile. */
export interface DomainProfile extends LoadoutProfile {
	/** Stable domain id, e.g. "frontend-ui". Used as the registry key. */
	readonly id: string;
	/** Human label, e.g. "Frontend & UI". */
	readonly label: string;
	/** Deterministic routing signals consumed by `domain-router.ts`. */
	readonly triggers: readonly TriggerSpec[];
	/**
	 * Detailed English routing prompt. When the router selects this domain, the
	 * orchestrator prepends this to the lane's task prompt so the model knows
	 * exactly which capabilities to lean on and how to sequence the work.
	 */
	readonly routingPrompt: string;
}

const READ_TOOLS: ToolGate = { allow: ["read", "grep", "find", "ls"] };
const WRITE_TOOLS: ToolGate = { allow: ["read", "grep", "find", "ls", "edit", "write", "bash"] };
const TEST_TOOLS: ToolGate = { allow: ["read", "grep", "find", "ls", "bash"] };
const SECURITY_TOOLS: ToolGate = { allow: ["read", "grep", "find", "ls", "bash"] };

function gate(kind: "skill" | "mcp" | "hook", names: readonly string[]): CapabilityGate {
	return { allow: [{ kind, names }] };
}

function commands(mode: LoadoutCommands["mode"], extras?: Partial<LoadoutCommands>): LoadoutCommands {
	return { mode, ...extras };
}

/**
 * All domain profiles, keyed by id. Order is intentional only for human reading;
 * the router scores every entry independently.
 *
 * Each profile curates real, currently-available resources. When a referenced
 * resource is not present in a given install, `applyLoadoutProfile()` simply
 * omits it (allow-lists are permissive intersections with inventory), so
 * profiles degrade gracefully on minimal installs.
 */
export const DOMAIN_PROFILES: Readonly<Record<string, DomainProfile>> = {
	"frontend-ui": {
		schemaVersion: "omk.loadout.v1",
		id: "frontend-ui",
		name: "frontend-ui",
		label: "Frontend & UI",
		authority: "write-scoped",
		tools: WRITE_TOOLS,
		skills: gate("skill", [
			"frontend-design",
			"frontend-ui-engineering",
			"frontend-patterns",
			"baseline-ui",
			"impeccable",
			"shape",
			"make-interfaces-feel-better",
			"transitions-dev",
			"animate",
			"polish",
			"layout",
			"typeset",
			"colorize",
			"oklch-skill",
			"high-end-visual-design",
			"minimalist-ui",
			"design-taste-frontend",
			"redesign-existing-projects",
			"web-design-guidelines",
			"fixing-accessibility",
			"contrast-checker",
			"use-of-color",
			"fixing-motion-performance",
			"12-principles-of-animation",
			"to-spring-or-not-to-spring",
			"mastering-animate-presence",
			"pseudo-elements",
			"shadcn",
			"next-best-practices",
			"next-cache-components",
			"vercel-react-best-practices",
			"vercel-composition-patterns",
			"vue-best-practices",
			"vue",
			"svelte-code-writer",
			"react-pdf",
			"remotion-best-practices",
			"web-quality-audit",
			"audit-and-fix",
			"image-to-code",
			"visual-ralph",
			"gstack-design-review",
			"gstack-design-html",
			"gstack-design-shotgun",
			"clone-website",
			"ui-design-brain",
			"interface-design",
			"emil-design-eng",
		]),
		mcp: gate("mcp", ["chrome-devtools", "playwright", "filesystem", "context7"]),
		hooks: gate("hook", ["typecheck-after-edit", "pre-shell-guard", "protect-secrets"]),
		commands: commands("scoped-shell"),
		triggers: [
			{ kind: "keyword", pattern: "ui", weight: 3 },
			{ kind: "keyword", pattern: "frontend", weight: 5 },
			{ kind: "keyword", pattern: "component", weight: 3 },
			{ kind: "keyword", pattern: "컴포넌트", weight: 4 },
			{ kind: "keyword", pattern: "디자인", weight: 4 },
			{ kind: "keyword", pattern: "css", weight: 4 },
			{ kind: "keyword", pattern: "tailwind", weight: 5 },
			{ kind: "keyword", pattern: "responsive", weight: 4 },
			{ kind: "keyword", pattern: "layout", weight: 3 },
			{ kind: "keyword", pattern: "design", weight: 3 },
			{ kind: "keyword", pattern: "accessibility", weight: 4 },
			{ kind: "keyword", pattern: "a11y", weight: 4 },
			{ kind: "keyword", pattern: "animation", weight: 4 },
			{ kind: "keyword", pattern: "pixel-perfect", weight: 5 },
			{ kind: "keyword", pattern: "landing page", weight: 5 },
			{ kind: "keyword", pattern: "redesign", weight: 4 },
			{ kind: "keyword", pattern: "button", weight: 2 },
			{ kind: "keyword", pattern: "modal", weight: 2 },
			{ kind: "keyword", pattern: "shadcn", weight: 5 },
			{ kind: "keyword", pattern: "clone", weight: 3 },
			{ kind: "regex", pattern: "\\b(react|vue|svelte|next\\.?js|nuxt)\\b", weight: 4 },
			{ kind: "regex", pattern: "\\b(tailwind|css|styled|emotion|radix)\\b", weight: 4 },
			{ kind: "extension", pattern: ".vue", weight: 6 },
			{ kind: "extension", pattern: ".tsx", weight: 4 },
			{ kind: "extension", pattern: ".jsx", weight: 4 },
			{ kind: "extension", pattern: ".css", weight: 5 },
			{ kind: "path", pattern: "components/", weight: 4 },
			{ kind: "path", pattern: "app/page", weight: 3 },
		],
		routingPrompt: `DOMAIN: Frontend & UI. You are operating in a frontend/UI capability lane.
Prioritize visual craft, correct component composition, and accessibility.

SEQUENCE:
1. Read the target component(s)/page(s) in full before editing. Do not edit blind from search snippets.
2. Identify the design system in use (Tailwind v4 / shadcn/ui / CSS modules / vanilla). Match it exactly; never introduce a second system.
3. For visual work: drive iteration with the chrome-devtools or playwright MCP (navigate, screenshot, diff) — do not claim "looks good" without a captured frame.
4. Accessibility: run the fixing-accessibility + contrast-checker + use-of-color skills. Every interactive element needs a reachable name, visible focus, and AA contrast.
5. Motion: prefer the transitions-dev / animate / 12-principles-of-animation skills; gate heavy effects behind fix-motion-performance so animation never blocks the main thread.
6. Prefer composition over boolean-prop sprawl (vercel-composition-patterns). Keep components small; extract when a prompt would exceed ~150 lines of spec.
7. Before claiming done: typecheck-after-edit hook must pass, plus the web-quality-audit skill (perf/a11y/SEO/best-practices).

HARD RULES: no inline styles when a token/utility exists; oklch tokens for color; mobile-first responsive; real content over placeholders; pixel-match the target first, customize later.`,
	},

	"backend-api": {
		schemaVersion: "omk.loadout.v1",
		id: "backend-api",
		name: "backend-api",
		label: "Backend & API",
		authority: "write-scoped",
		tools: WRITE_TOOLS,
		skills: gate("skill", [
			"backend-patterns",
			"api-design",
			"postgres-patterns",
			"supabase",
			"supabase-postgres-best-practices",
			"database-migrations",
			"clickhouse-io",
			"redis",
			"django-patterns",
			"django-tdd",
			"django-verification",
			"laravel-patterns",
			"laravel-tdd",
			"laravel-verification",
			"springboot-patterns",
			"springboot-tdd",
			"springboot-verification",
			"jpa-patterns",
			"python-patterns",
			"python-testing",
			"golang-patterns",
			"golang-testing",
			"kotlin-patterns",
			"rust-patterns",
			"java-coding-standards",
			"cpp-coding-standards",
			"perl-patterns",
			"mcp-server-patterns",
			"mcp-build-mcp",
			"claude-api",
			"codex-api",
			"security-review",
			"verification-loop",
		]),
		mcp: gate("mcp", ["filesystem", "supabase", "github", "context7", "memory"]),
		hooks: gate("hook", ["pre-shell-guard", "protect-secrets", "typecheck-after-edit", "npm-audit-summary"]),
		commands: commands("scoped-shell"),
		triggers: [
			{ kind: "keyword", pattern: "backend", weight: 5 },
			{ kind: "keyword", pattern: "api", weight: 4 },
			{ kind: "keyword", pattern: "endpoint", weight: 4 },
			{ kind: "keyword", pattern: "database", weight: 5 },
			{ kind: "keyword", pattern: "query performance", weight: 5 },
			{ kind: "keyword", pattern: "query", weight: 3 },
			{ kind: "keyword", pattern: "migration", weight: 5 },
			{ kind: "keyword", pattern: "schema", weight: 4 },
			{ kind: "keyword", pattern: "server", weight: 3 },
			{ kind: "keyword", pattern: "auth", weight: 4 },
			{ kind: "keyword", pattern: "postgres", weight: 6 },
			{ kind: "keyword", pattern: "supabase", weight: 6 },
			{ kind: "keyword", pattern: "sql", weight: 5 },
			{ kind: "keyword", pattern: "rest", weight: 3 },
			{ kind: "keyword", pattern: "graphql", weight: 4 },
			{ kind: "keyword", pattern: "orm", weight: 4 },
			{ kind: "keyword", pattern: "django", weight: 6 },
			{ kind: "keyword", pattern: "spring", weight: 6 },
			{ kind: "keyword", pattern: "laravel", weight: 6 },
			{ kind: "regex", pattern: "\\b(route|controller|service|repository|model|dto)\\b", weight: 3 },
			{ kind: "extension", pattern: ".py", weight: 3 },
			{ kind: "extension", pattern: ".go", weight: 5 },
			{ kind: "extension", pattern: ".rs", weight: 5 },
			{ kind: "extension", pattern: ".java", weight: 5 },
			{ kind: "extension", pattern: ".kt", weight: 5 },
			{ kind: "path", pattern: "api/", weight: 4 },
			{ kind: "path", pattern: "server/", weight: 4 },
			{ kind: "path", pattern: "migrations/", weight: 6 },
		],
		routingPrompt: `DOMAIN: Backend & API. You are operating in a backend/API capability lane.
Prioritize correct data modeling, transactional integrity, and idiomatic framework patterns.

SEQUENCE:
1. Read the affected route/controller/service/repo and the schema in full first.
2. For data changes: prefer the database-migrations skill (additive + backfill + expand/contract); never destructive in a single step. Validate with the framework verification skill (django-verification / laravel-verification / springboot-verification).
3. Query work: apply postgres-patterns / supabase-postgres-best-practices (indexes, EXPLAIN, RLS). ClickHouse analytics use clickhouse-io.
4. API shape: api-design skill for resource naming, status codes, pagination, error envelopes, versioning.
5. Integrating LLMs: claude-api / codex-api skills for correct model ids, streaming, tool use, caching. Building an MCP server: mcp-server-patterns + mcp-build-mcp.
6. Language idiom: use the matching *-patterns skill (python/golang/rust/kotlin/perl/cpp). Type-strict, no \`any\`.
7. Security baseline: run security-review before claiming done; secrets never logged (protect-secrets hook enforces).

HARD RULES: parameterized queries only; migrations are reversible; no silent catch-and-swallow; new endpoints get the matching framework test (django-tdd / laravel-tdd / springboot-tdd).`,
	},

	"data-science": {
		schemaVersion: "omk.loadout.v1",
		id: "data-science",
		name: "data-science",
		label: "Data Science & Analysis",
		authority: "execute-tests",
		tools: TEST_TOOLS,
		skills: gate("skill", [
			"exploratory-data-analysis",
			"polars",
			"dask",
			"matplotlib",
			"seaborn",
			"plotly",
			"scientific-visualization",
			"scikit-learn",
			"pytorch-lightning",
			"transformers",
			"networkx",
			"pymc",
			"statsmodels",
			"sympy",
			"statistical-analysis",
			"shap",
			"rdkit",
			"biopython",
			"scanpy",
			"astropy",
			"qiskit",
			"deepchem",
			"molecular-dynamics",
			"hypothesis-generation",
			"literature-review",
		]),
		mcp: gate("mcp", ["filesystem", "memory", "context7"]),
		hooks: gate("hook", ["pre-shell-guard", "protect-secrets", "stop-verify"]),
		commands: commands("tests-only"),
		triggers: [
			{ kind: "keyword", pattern: "data", weight: 3 },
			{ kind: "keyword", pattern: "analysis", weight: 4 },
			{ kind: "keyword", pattern: "dataframe", weight: 5 },
			{ kind: "keyword", pattern: "model", weight: 2 },
			{ kind: "keyword", pattern: "training", weight: 4 },
			{ kind: "keyword", pattern: "dataset", weight: 5 },
			{ kind: "keyword", pattern: "vector search", weight: 6 },
			{ kind: "keyword", pattern: "statistics", weight: 5 },
			{ kind: "keyword", pattern: "regression", weight: 4 },
			{ kind: "keyword", pattern: "classification", weight: 4 },
			{ kind: "keyword", pattern: "visualization", weight: 5 },
			{ kind: "keyword", pattern: "plot", weight: 4 },
			{ kind: "keyword", pattern: "notebook", weight: 5 },
			{ kind: "keyword", pattern: "pandas", weight: 6 },
			{ kind: "keyword", pattern: "polars", weight: 6 },
			{ kind: "keyword", pattern: "numpy", weight: 5 },
			{ kind: "keyword", pattern: "pytorch", weight: 6 },
			{ kind: "keyword", pattern: "tensorflow", weight: 5 },
			{ kind: "keyword", pattern: "scikit", weight: 6 },
			{ kind: "keyword", pattern: "bayesian", weight: 5 },
			{ kind: "regex", pattern: "\\b(eda|ml|machine learning|inference|embeddings?)\\b", weight: 5 },
			{ kind: "extension", pattern: ".ipynb", weight: 7 },
			{ kind: "path", pattern: "notebooks/", weight: 6 },
			{ kind: "path", pattern: "models/", weight: 3 },
		],
		routingPrompt: `DOMAIN: Data Science & Analysis. You are operating in an analysis/modeling capability lane.
Prioritize correct statistical reasoning, reproducibility, and honest uncertainty.

SEQUENCE:
1. Start with exploratory-data-analysis: shape, dtypes, missingness, distributions, basic sanity checks — never skip straight to modeling.
2. Pick the dataframe engine by size: polars for in-memory speed, dask for larger-than-RAM. Do not reach for pandas by reflex.
3. Visualization: seaborn/plotly for exploration, scientific-visualization for publication figures (colorblind-safe, correct error bars, journal styling).
4. Modeling: scikit-learn for classical, pytorch-lightning for DL. State assumptions, then validate with statistical-analysis (right test, assumption checks, power). Bayesian work uses pymc; report with statsmodels.
5. Interpretability: shap for global/local explanations; do not ship a black box without them.
6. Reproducibility: fix seeds, pin versions, commit the exact data hash. Prefer scripts/functions over ad-hoc notebook cells for anything reused.

HARD RULES: report effect size + CI, not just p-values; never train on test; never impute silently; notebooks are for exploration, modules are for production.`,
	},

	"security-audit": {
		schemaVersion: "omk.loadout.v1",
		id: "security-audit",
		name: "security-audit",
		label: "Security Audit",
		authority: "security-review",
		tools: SECURITY_TOOLS,
		skills: gate("skill", [
			"security-review",
			"security-scan",
			"differential-review",
			"semgrep",
			"codeql",
			"sarif-parsing",
			"semgrep-rule-creator",
			"sharp-edges",
			"supply-chain-risk-auditor",
			"spec-to-code-compliance",
			"entry-point-analyzer",
			"audit-context-building",
			"fp-check",
			"constant-time-analysis",
			"zeroize-audit",
			"agentic-actions-auditor",
			"insecure-defaults",
			"property-based-testing",
			"variant-analysis",
			"yara-rule-authoring",
			"code-maturity-assessor",
			"django-security",
			"springboot-security",
		]),
		mcp: gate("mcp", ["filesystem", "github", "memory"]),
		hooks: gate("hook", ["pre-shell-guard", "protect-secrets", "stop-verify", "subagent-stop-audit"]),
		commands: commands("read-only-shell"),
		triggers: [
			{ kind: "keyword", pattern: "security", weight: 6 },
			{ kind: "keyword", pattern: "vulnerability", weight: 6 },
			{ kind: "keyword", pattern: "vuln", weight: 6 },
			{ kind: "keyword", pattern: "exploit", weight: 6 },
			{ kind: "keyword", pattern: "audit", weight: 5 },
			{ kind: "keyword", pattern: "cve", weight: 7 },
			{ kind: "keyword", pattern: "xss", weight: 6 },
			{ kind: "keyword", pattern: "csrf", weight: 6 },
			{ kind: "keyword", pattern: "injection", weight: 6 },
			{ kind: "keyword", pattern: "secret", weight: 5 },
			{ kind: "keyword", pattern: "leak", weight: 5 },
			{ kind: "keyword", pattern: "crypto", weight: 4 },
			{ kind: "keyword", pattern: "hardening", weight: 5 },
			{ kind: "keyword", pattern: "threat model", weight: 5 },
			{ kind: "keyword", pattern: "threat", weight: 5 },
			{ kind: "keyword", pattern: "penetration", weight: 6 },
			{ kind: "keyword", pattern: "malware", weight: 6 },
			{ kind: "keyword", pattern: "supply chain", weight: 6 },
			{ kind: "regex", pattern: "sql[ -]?inj|command[ -]?inj|path[ -]?traversal", weight: 7 },
			{ kind: "regex", pattern: "cve-\\d{4}-\\d+", weight: 8 },
			{ kind: "regex", pattern: "\\b(authz|rbac|privilege escalation|idor)\\b", weight: 6 },
		],
		routingPrompt: `DOMAIN: Security Audit. You are operating in a security-review lane (read-biased, evidence-bound).
Prioritize true-positive findings with proof, exact locations, and remediation.

SEQUENCE:
1. Scope the audit: read entry-point-analyzer output (externally callable, state-changing surfaces) before reading internals.
2. Build deep context with audit-context-building; shallow reads miss cross-file data flow.
3. Run static analysis: semgrep (custom rules via semgrep-rule-creator) + codeql for inter-procedural taint. Parse results with sarif-parsing and dedupe.
4. Verify every candidate with fp-check — return TRUE/FALSE POSITIVE with evidence, never a bare "might be vulnerable".
5. Differential scope: differential-review on the diff/PR, not just the whole tree, to catch regressions.
6. Domain lenses: constant-time-analysis + zeroize-audit for crypto; supply-chain-risk-auditor for deps; agentic-actions-auditor for CI/LLM-agent workflows; sharp-edges + insecure-defaults for misuse-prone APIs.
7. After fixes: variant-analysis to find the same bug class elsewhere.

HARD RULES: read-only by default; every finding needs file:line + exploit sketch + fix; rank by real exploitability not CWE count; secrets are reported, never printed (protect-secrets hook).`,
	},

	"devops-infra": {
		schemaVersion: "omk.loadout.v1",
		id: "devops-infra",
		name: "devops-infra",
		label: "DevOps & Infrastructure",
		authority: "write-scoped",
		tools: WRITE_TOOLS,
		skills: gate("skill", [
			"deployment-patterns",
			"docker-patterns",
			"database-migrations",
			"continuous-agent-loop",
			"enterprise-agent-ops",
			"plankton-code-quality",
			"verification-loop",
			"deploy-to-vercel",
			"vercel-cli-with-tokens",
			"e2e-testing",
			"clickhouse-io",
			"security-review",
		]),
		mcp: gate("mcp", ["github", "filesystem", "powershell-admin"]),
		hooks: gate("hook", ["npm-audit-summary", "pre-shell-guard", "protect-secrets", "stop-verify"]),
		commands: commands("scoped-shell"),
		triggers: [
			{ kind: "keyword", pattern: "deploy", weight: 6 },
			{ kind: "keyword", pattern: "배포", weight: 6 },
			{ kind: "keyword", pattern: "deployment", weight: 6 },
			{ kind: "keyword", pattern: "docker", weight: 6 },
			{ kind: "keyword", pattern: "container", weight: 5 },
			{ kind: "keyword", pattern: "kubernetes", weight: 6 },
			{ kind: "keyword", pattern: "k8s", weight: 6 },
			{ kind: "keyword", pattern: "ci", weight: 3 },
			{ kind: "keyword", pattern: "pipeline", weight: 3 },
			{ kind: "keyword", pattern: "infrastructure", weight: 5 },
			{ kind: "keyword", pattern: "terraform", weight: 6 },
			{ kind: "keyword", pattern: "vercel", weight: 6 },
			{ kind: "keyword", pattern: "build", weight: 2 },
			{ kind: "keyword", pattern: "release", weight: 4 },
			{ kind: "keyword", pattern: "observability", weight: 5 },
			{ kind: "regex", pattern: "\\b(github actions|workflow|runner|helm|istio|nginx)\\b", weight: 5 },
			{ kind: "regex", pattern: "docker-?compose|\\.ya?ml", weight: 3 },
			{ kind: "path", pattern: "Dockerfile", weight: 7 },
			{ kind: "path", pattern: ".github/workflows/", weight: 7 },
			{ kind: "path", pattern: "docker-compose", weight: 7 },
			{ kind: "extension", pattern: ".tf", weight: 7 },
		],
		routingPrompt: `DOMAIN: DevOps & Infrastructure. You are operating in a delivery/infra capability lane.
Prioritize reproducible, reversible, observable changes.

SEQUENCE:
1. Read the Dockerfile / compose / workflow / IaC in full before editing.
2. Containers: docker-patterns — pin base images, non-root user, multi-stage build, .dockerignore, healthchecks, least network egress.
3. CI/CD: deployment-patterns for staging->prod, rollback strategy, secret handling. GitHub Actions touching LLM/agent steps must pass agentic-actions-auditor (you are in security-adjacent territory).
4. Deploys: deploy-to-vercel / vercel-cli-with-tokens for Vercel; verification-loop after every deploy (health, smoke, rollback trigger).
5. Database ops: database-migrations (expand/contract, zero-downtime) — coordinate with backend-api lane if schema semantics are unclear.
6. Supply chain: npm-audit-summary hook surfaces dep risk; do not add lifecycle-script deps silently.

HARD RULES: every deploy is reversible within one command; never bake secrets into images; lockfile/manifest changes are reviewed code; prefer idempotent steps. Read-only infra inspection uses read-only-shell; mutations stay scoped-shell.`,
	},

	research: {
		schemaVersion: "omk.loadout.v1",
		id: "research",
		name: "research",
		label: "Research & Investigation",
		authority: "read-only",
		tools: READ_TOOLS,
		skills: gate("skill", [
			"deep-research",
			"literature-review",
			"market-research",
			"exa-search",
			"best-practice-research",
			"arxiv-database",
			"pubmed-database",
			"scientific-brainstorming",
			"hypothesis-generation",
			"scientific-critical-thinking",
			"competitive-analysis",
			"content-strategy",
			"analyze",
		]),
		mcp: gate("mcp", ["firecrawl", "fetch", "github", "memory", "obsidian"]),
		hooks: gate("hook", ["session-context", "precompact-checkpoint"]),
		commands: commands("read-only-shell"),
		triggers: [
			{ kind: "keyword", pattern: "research", weight: 6 },
			{ kind: "keyword", pattern: "investigate", weight: 5 },
			{ kind: "keyword", pattern: "literature", weight: 6 },
			{ kind: "keyword", pattern: "survey", weight: 4 },
			{ kind: "keyword", pattern: "compare", weight: 3 },
			{ kind: "keyword", pattern: "market", weight: 4 },
			{ kind: "keyword", pattern: "competitor", weight: 5 },
			{ kind: "keyword", pattern: "paper", weight: 5 },
			{ kind: "keyword", pattern: "arxiv", weight: 7 },
			{ kind: "keyword", pattern: "pubmed", weight: 7 },
			{ kind: "keyword", pattern: "summarize", weight: 3 },
			{ kind: "keyword", pattern: "sources", weight: 4 },
			{ kind: "keyword", pattern: "cite", weight: 4 },
			{ kind: "regex", pattern: "\\b(state of the art|sota|benchmark|related work)\\b", weight: 5 },
			{ kind: "regex", pattern: "\\b(find out|look up|what does|why does)\\b", weight: 2 },
		],
		routingPrompt: `DOMAIN: Research & Investigation. You are operating in a read-only research lane.
Prioritize sourced, cited, reproducible findings over speculation.

SEQUENCE:
1. Decompose the question into sub-queries. Gather with the right source: arxiv-database / pubmed-database for academic, exa-search + firecrawl + fetch for web/github, market-research for commercial intel.
2. literature-review for systematic synthesis (PRISMA where applicable, verified citations, dedupe).
3. Evaluate evidence quality with scientific-critical-thinking (GRADE / risk of bias) before trusting a source.
4. Hypothesis generation when the goal is ideation; competitive-analysis when positioning a product.
5. Persist durable findings to memory + obsidian with source URLs and access dates; never store secrets or private PII.

HARD RULES: every claim has a citation; distinguish evidence vs inference explicitly; prefer primary/official sources; flag when evidence is thin rather than confabulating. Read-only: do not modify the codebase.`,
	},

	mobile: {
		schemaVersion: "omk.loadout.v1",
		id: "mobile",
		name: "mobile",
		label: "Mobile (iOS / Android / KMP)",
		authority: "write-scoped",
		tools: WRITE_TOOLS,
		skills: gate("skill", [
			"swiftui-patterns",
			"swiftui-ui-patterns",
			"swift-actor-persistence",
			"swift-concurrency-6-2",
			"swift-protocol-di-testing",
			"foundation-models-on-device",
			"liquid-glass-design",
			"android-clean-architecture",
			"compose-multiplatform-patterns",
			"kotlin-patterns",
			"kotlin-coroutines-flows",
			"kotlin-testing",
			"kotlin-exposed-patterns",
			"kotlin-ktor-patterns",
			"react-native-best-practices",
			"accessibility-audit",
		]),
		mcp: gate("mcp", ["filesystem", "chrome-devtools", "context7"]),
		hooks: gate("hook", ["typecheck-after-edit", "pre-shell-guard", "protect-secrets"]),
		commands: commands("scoped-shell"),
		triggers: [
			{ kind: "keyword", pattern: "ios", weight: 6 },
			{ kind: "keyword", pattern: "android", weight: 6 },
			{ kind: "keyword", pattern: "mobile", weight: 6 },
			{ kind: "keyword", pattern: "swift", weight: 6 },
			{ kind: "keyword", pattern: "swiftui", weight: 7 },
			{ kind: "keyword", pattern: "kotlin", weight: 6 },
			{ kind: "regex", pattern: "\\b(jetpack compose|compose multiplatform|android compose)\\b", weight: 7 },
			{ kind: "keyword", pattern: "kmp", weight: 6 },
			{ kind: "keyword", pattern: "react native", weight: 6 },
			{ kind: "keyword", pattern: "expo", weight: 5 },
			{ kind: "keyword", pattern: "flutter", weight: 6 },
			{ kind: "regex", pattern: "\\b(viewcontroller|uiview|jetpack|gradle|xcode)\\b", weight: 6 },
			{ kind: "extension", pattern: ".swift", weight: 8 },
			{ kind: "extension", pattern: ".kt", weight: 7 },
			{ kind: "path", pattern: "android/app", weight: 6 },
			{ kind: "path", pattern: "ios/", weight: 6 },
		],
		routingPrompt: `DOMAIN: Mobile (iOS / Android / KMP). You are operating in a mobile capability lane.
Prioritize platform idiom, main-thread performance, and on-device correctness.

SEQUENCE:
1. Identify the stack (SwiftUI / UIKit / Jetpack Compose / KMP / React Native / Flutter) and follow its idioms strictly.
2. iOS: swiftui-patterns + swift-concurrency-6-2 (structured concurrency, actor isolation). Persistence via swift-actor-persistence; testing via swift-protocol-di-testing. Use liquid-glass-design + foundation-models-on-device for iOS 26 features.
3. Android/KMP: android-clean-architecture (module boundaries, UseCase/Repository), compose-multiplatform-patterns, kotlin-coroutines-flows for async. Verify with kotlin-testing.
4. Performance: react-native-best-practices for RN (Hermes, FlashList, JS-thread); profile jank, never block the main thread, hoist heavy work off-thread.
5. Accessibility: accessibility-audit — Dynamic Type / VoiceOver / TalkBack, hit-target sizes, labeled controls.
6. Build gate: typecheck-after-edit must pass; prefer the platform's native test runner over ad-hoc scripts.

HARD RULES: no main-thread blocking; respect safe areas / insets / notches; lifecycle-aware state; pin toolchain versions (gradle/xcode) explicitly.`,
	},

	"docs-writing": {
		schemaVersion: "omk.loadout.v1",
		id: "docs-writing",
		name: "docs-writing",
		label: "Docs & Technical Writing",
		authority: "write-scoped",
		tools: WRITE_TOOLS,
		skills: gate("skill", [
			"article-writing",
			"doc-coauthoring",
			"write-concisely",
			"ux-writing",
			"copywriting",
			"copy-editing",
			"scientific-writing",
			"latex-posters",
			"academic-pptx",
			"slides-grab",
			"frontend-slides",
			"presentation-deck",
			"case-study",
			"design-rationale",
			"internal-comms",
			"docs-update-docs",
			"brand-voice",
			"brand-guidelines",
			"theme-factory",
			"web-asset-generator",
		]),
		mcp: gate("mcp", ["filesystem", "memory", "obsidian"]),
		hooks: gate("hook", ["session-context", "precompact-checkpoint", "pre-shell-guard"]),
		commands: commands("scoped-shell"),
		triggers: [
			{ kind: "keyword", pattern: "documentation", weight: 6 },
			{ kind: "keyword", pattern: "문서", weight: 6 },
			{ kind: "keyword", pattern: "docs", weight: 5 },
			{ kind: "keyword", pattern: "readme", weight: 6 },
			{ kind: "keyword", pattern: "write", weight: 2 },
			{ kind: "keyword", pattern: "article", weight: 5 },
			{ kind: "keyword", pattern: "blog", weight: 4 },
			{ kind: "keyword", pattern: "guide", weight: 4 },
			{ kind: "keyword", pattern: "tutorial", weight: 5 },
			{ kind: "keyword", pattern: "튜토리얼", weight: 5 },
			{ kind: "keyword", pattern: "작성", weight: 2 },
			{ kind: "keyword", pattern: "slides", weight: 5 },
			{ kind: "keyword", pattern: "슬라이드", weight: 5 },
			{ kind: "keyword", pattern: "발표", weight: 3 },
			{ kind: "keyword", pattern: "presentation", weight: 5 },
			{ kind: "keyword", pattern: "changelog", weight: 6 },
			{ kind: "keyword", pattern: "microcopy", weight: 5 },
			{ kind: "keyword", pattern: "manuscript", weight: 5 },
			{ kind: "regex", pattern: "\\b(prose|rewrite|edit copy|proofread)\\b", weight: 5 },
			{ kind: "extension", pattern: ".md", weight: 4 },
			{ kind: "extension", pattern: ".mdx", weight: 4 },
			{ kind: "extension", pattern: ".tex", weight: 6 },
			{ kind: "extension", pattern: ".pptx", weight: 6 },
			{ kind: "path", pattern: "docs/", weight: 5 },
			{ kind: "path", pattern: "CHANGELOG", weight: 6 },
		],
		routingPrompt: `DOMAIN: Docs & Technical Writing. You are operating in a writing capability lane.
Prioritize clarity, accuracy, and the reader's time.

SEQUENCE:
1. Audience first: decide reader level, then choose register. Technical docs use write-concisely (cut hedging, active voice, concrete nouns).
2. Collaborative/long docs: doc-coauthoring workflow (transfer context, iterate, verify it works for a reader).
3. Prose type: article-writing for long-form; ux-writing for in-product microcopy/error/empty states; copywriting for marketing; internal-comms for status/incident/announcement.
4. Academic: scientific-writing (IMRAD, citations, CONSORT/STROBE) + latex-posters; academic-pptx governs talk content/structure.
5. Slides: slides-grab (plan->design->export) or frontend-slides for web decks; presentation-deck for stakeholder framing.
6. Sync: docs-update-docs keeps READMEs/JSDoc/API docs current with code changes; keep CHANGELOG entries under [Unreleased].

HARD RULES: no marketing fluff in technical docs; every code example is runnable; screenshots reflect current UI; brand-voice/brand-guidelines for tone consistency.`,
	},

	"qa-testing": {
		schemaVersion: "omk.loadout.v1",
		id: "qa-testing",
		name: "qa-testing",
		label: "QA & Testing",
		authority: "execute-tests",
		tools: TEST_TOOLS,
		skills: gate("skill", [
			"ai-regression-testing",
			"e2e-testing",
			"tdd-workflow",
			"test-driven-development",
			"tdd-fix-tests",
			"tdd-write-tests",
			"react-doctor",
			"web-quality-audit",
			"audit-and-fix",
			"browser-qa",
			"webapp-testing",
			"verification-before-completion",
			"verification-loop",
			"playwright-cli",
			"gstack-qa",
			"gstack-qa-only",
		]),
		mcp: gate("mcp", ["playwright", "chrome-devtools", "filesystem"]),
		hooks: gate("hook", ["stop-verify", "pre-shell-guard", "protect-secrets"]),
		commands: commands("tests-only"),
		triggers: [
			{ kind: "keyword", pattern: "test", weight: 4 },
			{ kind: "keyword", pattern: "testing", weight: 5 },
			{ kind: "keyword", pattern: "qa", weight: 6 },
			{ kind: "keyword", pattern: "bug", weight: 4 },
			{ kind: "keyword", pattern: "버그", weight: 4 },
			{ kind: "keyword", pattern: "테스트", weight: 5 },
			{ kind: "keyword", pattern: "regression", weight: 6 },
			{ kind: "keyword", pattern: "e2e", weight: 7 },
			{ kind: "keyword", pattern: "playwright", weight: 7 },
			{ kind: "keyword", pattern: "vitest", weight: 6 },
			{ kind: "keyword", pattern: "jest", weight: 5 },
			{ kind: "keyword", pattern: "pytest", weight: 6 },
			{ kind: "keyword", pattern: "coverage", weight: 5 },
			{ kind: "keyword", pattern: "fix test", weight: 5 },
			{ kind: "keyword", pattern: "failing", weight: 4 },
			{ kind: "keyword", pattern: "flaky", weight: 6 },
			{ kind: "regex", pattern: "\\b(unit tests?|integration tests?|snapshot|mock|fixture)\\b", weight: 6 },
			{ kind: "path", pattern: "test/", weight: 5 },
			{ kind: "path", pattern: "tests/", weight: 5 },
			{ kind: "path", pattern: ".test.", weight: 5 },
			{ kind: "path", pattern: ".spec.", weight: 5 },
		],
		routingPrompt: `DOMAIN: QA & Testing. You are operating in an execute-tests lane.
Prioritize real evidence (green runs, captured output) over claims.

SEQUENCE:
1. Reproduce first: never fix a test you have not seen fail. Capture the exact failure output.
2. New behavior: test-driven-development / tdd-workflow (red->green->refactor). tdd-write-tests for coverage of uncommitted changes; tdd-fix-tests to make the suite green after a change.
3. Web QA: browser-qa / webapp-testing with playwright + chrome-devtools MCP (navigate, interact, screenshot, assert). e2e-testing for Page Object Model + CI wiring + flake strategy.
4. React: react-doctor (lint/a11y/bundle/arch + regression check) before declaring healthy.
5. Regression safety: ai-regression-testing for sandbox-mode API tests without DB deps; verification-before-completion requires a passing command before any "done" claim.
6. Flakiness: quarantine or fix, never disable silently; record the root cause.

HARD RULES: tests-only command mode (no arbitrary shell); every fix is re-verified by a green run; coverage gaps are reported, not hidden; flaky tests are rooted, not retried blindly.`,
	},

	"ai-agent-ops": {
		schemaVersion: "omk.loadout.v1",
		id: "ai-agent-ops",
		name: "ai-agent-ops",
		label: "AI Agent Engineering & Ops",
		authority: "write-scoped",
		tools: WRITE_TOOLS,
		skills: gate("skill", [
			"agent-harness-construction",
			"agentic-engineering",
			"ai-first-engineering",
			"autonomous-loops",
			"continuous-agent-loop",
			"enterprise-agent-ops",
			"eval-harness",
			"agent-self-evaluation",
			"agent-eval",
			"mcp-builder",
			"mcp-server-patterns",
			"prompt-optimizer",
			"context-engineering",
			"create-agent",
			"create-skill",
			"create-hook",
			"iterative-retrieval",
			"nanoclaw-repl",
			"blueprint",
			"ralphinho-rfc-pipeline",
			"harness",
			"subagent-driven-development",
			"dispatching-parallel-agents",
		]),
		mcp: gate("mcp", ["filesystem", "memory", "github", "context7"]),
		hooks: gate("hook", ["session-context", "precompact-checkpoint", "stop-verify", "subagent-stop-audit"]),
		commands: commands("scoped-shell"),
		triggers: [
			{ kind: "keyword", pattern: "agent", weight: 4 },
			{ kind: "keyword", pattern: "mcp", weight: 6 },
			{ kind: "keyword", pattern: "prompt", weight: 4 },
			{ kind: "keyword", pattern: "skill", weight: 3 },
			{ kind: "keyword", pattern: "hook", weight: 3 },
			{ kind: "keyword", pattern: "훅", weight: 4 },
			{ kind: "keyword", pattern: "harness", weight: 6 },
			{ kind: "regex", pattern: "\\borchestrat\\w*\\b", weight: 5 },
			{ kind: "keyword", pattern: "eval", weight: 5 },
			{ kind: "keyword", pattern: "subagent", weight: 6 },
			{ kind: "keyword", pattern: "tool", weight: 2 },
			{ kind: "keyword", pattern: "loop", weight: 3 },
			{ kind: "keyword", pattern: "context engineering", weight: 6 },
			{ kind: "regex", pattern: "\\b(model context protocol|llm agent|multi-?agent|agentic)\\b", weight: 6 },
			{ kind: "regex", pattern: "\\b(token budget|context window|compaction|retrieval)\\b", weight: 5 },
			{ kind: "path", pattern: ".claude/agents", weight: 6 },
			{ kind: "path", pattern: ".omk/", weight: 5 },
			{ kind: "path", pattern: "SKILL.md", weight: 5 },
		],
		routingPrompt: `DOMAIN: AI Agent Engineering & Ops. You are operating in an agent-systems capability lane.
Prioritize eval-driven design, correct context engineering, and safe autonomy.

SEQUENCE:
1. Frame the system: agentic-engineering (eval-first, decomposition, cost-aware routing) + ai-first-engineering operating model.
2. Context: context-engineering for prompt/command/skill/sub-agent construction; iterative-retrieval to solve the subagent context problem; prompt-optimizer before shipping prompts (test with a fresh subagent, RED-GREEN-REFACTOR).
3. Build artifacts: create-agent / create-skill / create-hook for the harness; mcp-builder + mcp-server-patterns for MCP servers (correct tool schemas, Zod, stdio vs HTTP).
4. Autonomy: autonomous-loops / continuous-agent-loop with quality gates + recovery; enterprise-agent-ops for long-lived workloads (observability, boundaries, lifecycle).
5. Evaluate: eval-harness + agent-eval + agent-self-evaluation — never ship an agent change without a measured eval delta. nanoclaw-repl for interactive iteration.
6. Orchestration: harness (team-architecture factory) for multi-agent topology; dispatching-parallel-agents / subagent-driven-development for parallel lanes; ralphinho-rfc-pipeline for DAG + merge queue.

HARD RULES: every agent/skill change has an eval; prompts are versioned and tested, not vibe-edited; MCP servers validate inputs; autonomy is bounded by explicit stop conditions + stop-verify hook.`,
	},

	general: {
		schemaVersion: "omk.loadout.v1",
		id: "general",
		name: "general",
		label: "General (fallback)",
		authority: "write-scoped",
		tools: WRITE_TOOLS,
		skills: gate("skill", [
			"coding-standards",
			"verification-before-completion",
			"systematic-debugging",
			"receiving-code-review",
			"context-engineering",
			"understand-chat",
			"brainstorming",
		]),
		mcp: gate("mcp", ["filesystem", "context7", "memory"]),
		hooks: gate("hook", ["pre-shell-guard", "protect-secrets", "stop-verify"]),
		commands: commands("scoped-shell"),
		triggers: [
			{ kind: "keyword", pattern: "refactor", weight: 2 },
			{ kind: "keyword", pattern: "fix", weight: 2 },
			{ kind: "keyword", pattern: "implement", weight: 2 },
			{ kind: "keyword", pattern: "function", weight: 1 },
		],
		routingPrompt: `DOMAIN: General. No specific domain scored above threshold, so apply broad engineering hygiene.

SEQUENCE:
1. understand-chat / brainstorming to confirm intent if ambiguous; otherwise read the target in full.
2. coding-standards for idiom; systematic-debugging for any defect (reproduce -> isolate -> fix -> verify, never guess).
3. verification-before-completion: run the real check command and show output before claiming done.
4. receiving-code-review: treat feedback technically, verify before applying.

HARD RULES: read before edit; smallest safe change; verify with evidence; ask one concise question if truly blocked.`,
	},
};

/** Ordered list of non-fallback domain ids (excludes "general"). */
export const DOMAIN_IDS: readonly string[] = Object.keys(DOMAIN_PROFILES).filter((id) => id !== "general");

/** The fallback profile used when no domain clears the confidence threshold. */
export const FALLBACK_DOMAIN_ID = "general";

/** Look up a domain profile by id. Returns the fallback profile if missing. */
export function getDomainProfile(id: string): DomainProfile {
	return DOMAIN_PROFILES[id] ?? DOMAIN_PROFILES[FALLBACK_DOMAIN_ID];
}

/** Convenience: map domain ids to their loadout profile (for applyLoadoutProfile). */
export function domainLoadoutProfiles(): Readonly<Record<string, LoadoutProfile>> {
	const out: Record<string, LoadoutProfile> = {};
	for (const [id, profile] of Object.entries(DOMAIN_PROFILES)) {
		const { id: _id, label: _label, triggers: _triggers, routingPrompt: _routingPrompt, ...loadout } = profile;
		out[id] = loadout;
	}
	return out;
}
