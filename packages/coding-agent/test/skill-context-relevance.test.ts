import { describe, expect, it } from "vitest";
import { rankRelevantSkills, recentUserPrompts } from "../src/core/skill-context-relevance.ts";
import type { Skill } from "../src/core/skills.ts";

function skill(name: string, description: string): Skill {
	return {
		name,
		description,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
		sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "test", scope: "user", origin: "top-level" },
		disableModelInvocation: false,
	};
}

// Descriptions trimmed from the real OMK catalog, so the eval measures the production scorer on real wording.
const CATALOG = [
	skill(
		"python-testing",
		"Python testing strategies using pytest, TDD methodology, fixtures, mocking, parametrization, and coverage.",
	),
	skill(
		"docker-patterns",
		"Docker and Docker Compose patterns for local development, container security, networking, volume strategies.",
	),
	skill(
		"api-design",
		"REST API design patterns including resource naming, status codes, pagination, filtering, error responses, versioning.",
	),
	skill(
		"omk-pdf",
		"Structured information extraction from PDFs and long documents with precise source grounding, contracts, reports.",
	),
	skill(
		"seaborn",
		"Statistical visualization with pandas integration. Box plots, violin plots, pair plots, heatmaps.",
	),
	skill(
		"polars",
		"Fast in-memory DataFrame library. Lazy evaluation, parallel execution, Apache Arrow backend, faster pandas replacement.",
	),
	skill(
		"shap",
		"Model interpretability using SHAP. Feature importance, waterfall, beeswarm plots for XGBoost and LightGBM.",
	),
	skill(
		"rdkit",
		"Cheminformatics toolkit. SMILES/SDF parsing, descriptors, fingerprints, substructure search, similarity.",
	),
	skill(
		"scanpy",
		"Standard single-cell RNA-seq analysis pipeline. QC, normalization, PCA/UMAP, clustering, differential expression.",
	),
	skill("pi-worktree", "Create, enter, inspect, and clean up git worktrees for isolated work."),
	skill("omk-seo", "Technical SEO: robots.txt, sitemap, meta tags, canonical, Open Graph, structured data, JSON-LD."),
	skill(
		"omk-pytorch",
		"PyTorch training and inference, torch.compile graph breaks, CUDA OOM and memory snapshots, profiler traces.",
	),
	skill(
		"programming",
		"Engineering for TypeScript, Python, Rust and Go: scope first, minimal typed implementation, verification.",
	),
	skill(
		"debugging",
		"Runtime debugging: reproduce the cause, lock a regression, fix minimally, verify the real entry point.",
	),
	skill(
		"omk-frontend",
		"Frontend UI work: React, Tailwind, design tokens, accessibility, responsive layout, visual QA.",
	),
	skill(
		"security-review",
		"Security checklist for authentication, user input, secrets, API endpoints and payment features.",
	),
];

// [earlier prompt, signal-less follow-up, skill the follow-up still needs]
const FOLLOW_UPS: ReadonlyArray<readonly [string, string, string]> = [
	["pytest fixture로 parametrize 테스트 작성해줘", "이것도 추가해줘", "python-testing"],
	["Docker Compose로 postgres 컨테이너 networking 구성해줘", "다시 해줘", "docker-patterns"],
	["REST API pagination이랑 error response 설계해줘", "continue", "api-design"],
	["PDF 계약서에서 contracts 조건 extraction 해줘", "나머지도", "omk-pdf"],
	["seaborn violin plot 그려줘", "색만 바꿔줘", "seaborn"],
	["polars DataFrame lazy groupby가 느려", "왜 그래?", "polars"],
	["SHAP waterfall plot으로 XGBoost 설명해줘", "하나 더", "shap"],
	["SMILES 분자 fingerprint similarity 계산해줘", "이어서", "rdkit"],
	["scanpy로 single-cell UMAP clustering 해줘", "ok go", "scanpy"],
	["git worktree 만들어서 격리 작업해줘", "그걸로 해", "pi-worktree"],
	["sitemap이랑 robots.txt, meta tags 점검해줘", "고쳐줘", "omk-seo"],
	["CUDA OOM이랑 torch.compile graph break 잡아줘", "아직도 안돼", "omk-pytorch"],
];

const LIMIT = 5;

function recallAt5(withContext: boolean): number {
	const hits = FOLLOW_UPS.filter(([earlier, followUp, expected]) =>
		rankRelevantSkills(CATALOG, followUp, [], withContext ? [earlier] : [], LIMIT).some((s) => s.name === expected),
	);
	return hits.length / FOLLOW_UPS.length;
}

describe("rankRelevantSkills offline eval", () => {
	it("recovers the continued task's skill on signal-less follow-ups (recall@5)", () => {
		const without = recallAt5(false);
		const withContext = recallAt5(true);
		expect(withContext).toBeGreaterThanOrEqual(0.9);
		expect(withContext).toBeGreaterThan(without);
	});

	it("ranks a prompt with its own signal by itself only, so a topic switch drops the old topic", () => {
		const query = "Docker Compose postgres container networking";
		const earlier = ["pytest fixture parametrize coverage"];
		const plain = rankRelevantSkills(CATALOG, query, [], [], LIMIT).map((s) => s.name);
		expect(rankRelevantSkills(CATALOG, query, [], earlier, LIMIT).map((s) => s.name)).toEqual(plain);
		expect(plain[0]).toBe("docker-patterns");
	});

	it("weights the previous prompt over the one before it", () => {
		const ranked = rankRelevantSkills(
			CATALOG,
			"계속",
			[],
			["seaborn violin plot heatmap", "pytest fixtures mocking"],
			LIMIT,
		).map((s) => s.name);
		expect(ranked.indexOf("seaborn")).toBeLessThan(ranked.indexOf("python-testing"));
	});

	it("keeps active skills out and returns nothing for an empty prompt", () => {
		expect(rankRelevantSkills(CATALOG, "다시", ["python-testing"], ["pytest fixtures"], LIMIT)).not.toContainEqual(
			expect.objectContaining({ name: "python-testing" }),
		);
		expect(rankRelevantSkills(CATALOG, "  ", [], ["pytest fixtures"], LIMIT)).toEqual([]);
	});
});

describe("recentUserPrompts", () => {
	it("returns the last non-empty user texts newest first, skipping other roles", () => {
		const history = [
			{ role: "user", content: "first" },
			{ role: "assistant", content: [{ type: "text", text: "answer" }] },
			{ role: "user", content: [{ type: "text", text: "second" }, { type: "image" }] },
			{ role: "custom", content: "prompt skills" },
			{ role: "user", content: "   " },
			{ role: "user", content: "third" },
			{ role: "bashExecution" },
		];
		expect(recentUserPrompts(history)).toEqual(["third", "second"]);
		expect(recentUserPrompts(history, 5)).toEqual(["third", "second", "first"]);
	});

	it("reduces each prompt to its first 8 distinct tokens so a long paste cannot dominate the scoring cost", () => {
		const long = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
		expect(recentUserPrompts([{ role: "user", content: long }])[0]?.split(" ")).toHaveLength(8);
	});
});
