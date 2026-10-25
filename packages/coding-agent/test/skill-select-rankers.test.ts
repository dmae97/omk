import childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	contentTokens,
	METACON_PLAN_BUDGET_MS,
	METACON_PREFILTER,
	type RankDoc,
	rankSkills,
} from "../src/core/skill-select-rankers.ts";
import { searchCorpus } from "../src/metacognition/retrieval.ts";

// Spec 058 AC 2: fixed fixtures, no file system, no model.
const doc = (name: string, description: string, contentHash = `hash-${name}`): RankDoc => ({
	name,
	description,
	location: `/skills/${name}/SKILL.md`,
	contentHash,
});
const filler = (count: number): RankDoc[] =>
	Array.from({ length: count }, (_, i) => doc(`filler-${i}`, `General helper number ${i} for everyday chores.`));

const PDF = [
	doc("pdf-forms", "Fill PDF forms. PDF fields, PDF checkboxes."),
	doc("pdf-extract", "Extract text and tables from PDF files."),
	doc("pdf-merge", "Merge and split PDF documents."),
];
const KUBE = doc("kubernetes-deploy", "Deploy services to a kubernetes cluster with helm.");
const DOCS = [...PDF, KUBE, ...filler(30)];

describe("bm25 mode (spec 058 R2)", () => {
	it("is searchCorpus order (ties by name), one source, matchCount = positive scores", () => {
		const result = rankSkills("bm25", "pdf", DOCS, { limit: 2 });
		const corpus = DOCS.map((d) => ({ id: d.name, uri: d.location, body: `${d.name} ${d.description}` }));
		const expected = searchCorpus("pdf", corpus, 64).map((hit) => hit.id);
		expect(result.hits.map((hit) => hit.name)).toEqual(expected.slice(0, 2));
		expect(result.hits.every((hit) => hit.source === "bm25")).toBe(true);
		expect(result.matchCount).toBe(expected.length);
		expect(result.metacon).toBeUndefined();
	});

	it("reuses document terms across queries without caching exclusions or stale bodies", () => {
		const docs = [doc("pdf", "PDF forms"), doc("kube", "kubernetes deploy")];
		rankSkills("bm25", "pdf", docs, { limit: 2 });
		const normalize = vi.spyOn(String.prototype, "normalize");
		try {
			expect(rankSkills("bm25", "kubernetes", docs, { limit: 2 }).hits.map((hit) => hit.name)).toEqual(["kube"]);
			expect(normalize).toHaveBeenCalledTimes(1);
			expect(rankSkills("bm25", "kubernetes", docs, { limit: 2, exclude: new Set(["kube"]) }).hits).toEqual([]);
			docs[1] = doc("kube", "PDF deploy");
			expect(rankSkills("bm25", "kubernetes", docs, { limit: 2 }).hits).toEqual([]);
		} finally {
			normalize.mockRestore();
		}
	});

	it("breaks equal scores by name", () => {
		// Same length and term counts, so equal BM25 scores; the order must not depend on the input order.
		const twins = [doc("b-twin", "same words here"), doc("a-twin", "same words here"), ...filler(5)];
		for (const input of [twins, [...twins].reverse()]) {
			expect(rankSkills("bm25", "same words", input, { limit: 2 }).hits.map((hit) => hit.name)).toEqual([
				"a-twin",
				"b-twin",
			]);
		}
	});

	it("merges skills with the same contentHash, keeps same text with different hashes", () => {
		const copies = [doc("pdf-a", "Fill PDF forms.", "same"), doc("pdf-b", "Fill PDF forms.", "same"), ...filler(5)];
		expect(rankSkills("bm25", "pdf forms", copies, { limit: 5 }).hits.map((hit) => hit.name)).toEqual(["pdf-a"]);
		const distinct = [doc("pdf-a", "Fill PDF forms.", "h1"), doc("pdf-b", "Fill PDF forms.", "h2"), ...filler(5)];
		expect(rankSkills("bm25", "pdf forms", distinct, { limit: 5 }).hits).toHaveLength(2);
	});

	it("never returns excluded names and returns nothing for an empty query", () => {
		const hits = rankSkills("bm25", "pdf", DOCS, { limit: 5, exclude: new Set(["pdf-forms"]) }).hits;
		expect(hits.map((hit) => hit.name)).not.toContain("pdf-forms");
		expect(rankSkills("bm25", "   ", DOCS, { limit: 5 })).toEqual({ hits: [], matchCount: 0 });
	});
});

describe("metacon mode (spec 058 R4)", () => {
	it("covers both needs instead of two skills for the same need", () => {
		const result = rankSkills("metacon", "pdf kubernetes", DOCS, { limit: 2 });
		const names = result.hits.map((hit) => hit.name);
		expect(names).toContain("kubernetes-deploy");
		expect(names.filter((name) => name.startsWith("pdf-"))).toHaveLength(1);
		expect(result.hits.every((hit) => hit.source === "metacon")).toBe(true);
		expect(result.metacon).toMatchObject({ needs: 2, coveredNeeds: 2, phase: "task", phaseSource: "default" });
	});

	it("fills the slots metacon leaves empty in BM25 order and marks them bm25-fill (R4.4)", () => {
		const result = rankSkills("metacon", "pdf", DOCS, { limit: 3 });
		expect(result.hits).toHaveLength(3);
		expect(result.hits[0].source).toBe("metacon");
		expect(result.hits.slice(1).map((hit) => hit.source)).toEqual(["bm25-fill", "bm25-fill"]);
		const bm25 = rankSkills("bm25", "pdf", DOCS, { limit: 3 }).hits.map((hit) => hit.name);
		expect(new Set(result.hits.map((hit) => hit.name))).toEqual(new Set(bm25));
		const fills = result.hits.slice(1).map((hit) => hit.name);
		expect(fills).toEqual(bm25.filter((name) => fills.includes(name)));
	});

	it("returns metacon picks in BM25 order and every hit keeps its BM25 score", () => {
		const result = rankSkills("metacon", "pdf kubernetes", DOCS, { limit: 4 });
		const bm25 = rankSkills("bm25", "pdf kubernetes", DOCS, { limit: 64 }).hits;
		const scoreOf = new Map(bm25.map((hit) => [hit.name, hit.score]));
		for (const hit of result.hits) expect(hit.score).toBe(scoreOf.get(hit.name));
		const picks = result.hits.filter((hit) => hit.source === "metacon").map((hit) => hit.name);
		expect(picks).toEqual(bm25.map((hit) => hit.name).filter((name) => picks.includes(name)));
	});

	it("dedupes needs before planSkills and uses the todo phase when given", () => {
		const result = rankSkills("metacon", "pdf pdf PDF kubernetes kubernetes", DOCS, { limit: 2, phase: "debug" });
		expect(result.metacon).toMatchObject({ needs: 2, phase: "debug", phaseSource: "todo" });
		expect(result.metacon?.fallback).toBeUndefined();
	});

	it("plans over at most the BM25 top 64", () => {
		const many = Array.from({ length: 90 }, (_, i) => doc(`pdf-${i}`, `PDF helper ${i}.`));
		expect(rankSkills("metacon", "pdf", many, { limit: 5 }).metacon?.prefilter).toBe(METACON_PREFILTER);
	});

	it("falls back to the BM25 list only when planSkills throws (R4.5)", () => {
		// A 600-character word is a valid BM25 term but an invalid planSkills capability (max 500).
		const long = "x".repeat(600);
		const docs = [doc("pdf-long", `PDF ${long}`), ...PDF, ...filler(5)];
		const result = rankSkills("metacon", "pdf", docs, { limit: 3 });
		expect(result.metacon?.fallback).toBe("metacon-error");
		expect(result.hits.map((hit) => hit.name)).toEqual(
			rankSkills("bm25", "pdf", docs, { limit: 3 }).hits.map((hit) => hit.name),
		);
		expect(result.hits.every((hit) => hit.source === "bm25")).toBe(true);
	});

	it("keeps an explicit skill that is in the prefilter", () => {
		const result = rankSkills("metacon", "pdf", DOCS, { limit: 1, explicit: ["pdf-merge", "not-a-skill"] });
		expect(result.hits.map((hit) => hit.name)).toEqual(["pdf-merge"]);
	});

	it("logs the plan time against a 50 ms budget without cutting it off (R4.6)", () => {
		const result = rankSkills("metacon", "pdf kubernetes", DOCS, { limit: 3 });
		expect(METACON_PLAN_BUDGET_MS).toBe(50);
		const stats = result.metacon;
		expect(typeof stats?.planMs).toBe("number");
		if (stats?.overBudget) expect(stats.planMs).toBeGreaterThan(METACON_PLAN_BUDGET_MS);
	});
});

interface Fixture {
	readonly skills: readonly { name: string; description: string }[];
	readonly queries: readonly { id: string; text: string }[];
}
const FIXTURE = JSON.parse(
	readFileSync(new URL("./fixtures/skill-select/catalog.json", import.meta.url), "utf8"),
) as Fixture;
const FIXTURE_DOCS = FIXTURE.skills.map((skill) => doc(skill.name, skill.description));

describe("fixed fixture: 40 skills, 5 queries (spec 058 AC 2)", () => {
	it("bm25 and metacon top 3 match the recorded golden output", () => {
		const golden = FIXTURE.queries.map((query) => ({
			id: query.id,
			bm25: rankSkills("bm25", query.text, FIXTURE_DOCS, { limit: 3 }).hits.map(
				(hit) => `${hit.name} ${hit.score.toFixed(3)}`,
			),
			metacon: rankSkills("metacon", query.text, FIXTURE_DOCS, { limit: 3 }).hits.map(
				(hit) => `${hit.name} ${hit.source}`,
			),
		}));
		expect(golden).toMatchSnapshot();
	});

	it("metacon mixes in a skill for the other query word where bm25 returns one cluster", () => {
		const bm25 = rankSkills("bm25", "csv plot", FIXTURE_DOCS, { limit: 3 }).hits.map((hit) => hit.name);
		expect(bm25.every((name) => name.startsWith("csv-"))).toBe(true);
		const metacon = rankSkills("metacon", "csv plot", FIXTURE_DOCS, { limit: 3 }).hits.map((hit) => hit.name);
		expect(metacon).toContain("chart-render");
	});

	it("gives the same output for the same input", () => {
		for (const query of FIXTURE.queries) {
			const first = rankSkills("metacon", query.text, FIXTURE_DOCS, { limit: 3 });
			const second = rankSkills("metacon", query.text, [...FIXTURE_DOCS], { limit: 3 });
			expect(second.hits).toEqual(first.hits);
		}
	});

	it("plans in under 50 ms at p99 on 1,191 synthetic skills, BM25 prefilter included", () => {
		const words = FIXTURE.skills.flatMap((skill) => contentTokens(skill.description));
		const big = Array.from({ length: 1191 }, (_, i) =>
			doc(`synthetic-${i}`, Array.from({ length: 12 }, (_, j) => words[(i * 7 + j * 13) % words.length]).join(" ")),
		);
		rankSkills("metacon", "warm up", big, { limit: 3 });
		const times: number[] = [];
		for (let round = 0; round < 20; round++) {
			for (const query of FIXTURE.queries) {
				const started = performance.now();
				rankSkills("metacon", query.text, big, { limit: 3 });
				times.push(performance.now() - started);
			}
		}
		times.sort((a, b) => a - b);
		expect(times[Math.ceil(times.length * 0.99) - 1]).toBeLessThan(METACON_PLAN_BUDGET_MS);
	});
});

describe("local only (spec 058 AC 6)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("makes no fetch, net.connect or child_process call in either mode", () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const connectSpy = vi.spyOn(net, "connect");
		const spawnSpy = vi.spyOn(childProcess, "spawn");
		const execSpy = vi.spyOn(childProcess, "execFile");
		for (const mode of ["bm25", "metacon"] as const) {
			for (const query of FIXTURE.queries) rankSkills(mode, query.text, FIXTURE_DOCS, { limit: 3 });
		}
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(connectSpy).not.toHaveBeenCalled();
		expect(spawnSpy).not.toHaveBeenCalled();
		expect(execSpy).not.toHaveBeenCalled();
	});

	it("imports no Adaptorch, MCP or network module", () => {
		const files = [
			"../src/core/skill-select-rankers.ts",
			"../src/core/skill-search.ts",
			"../src/core/skill-index-store.ts",
			"../src/metacognition/skills.ts",
		];
		for (const file of files) {
			const source = readFileSync(new URL(file, import.meta.url), "utf8");
			const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
			for (const specifier of specifiers) {
				expect(specifier).not.toMatch(/adaptorch|mcp|node:(http|https|net|dns)|undici|fetch/);
			}
		}
	});
});

describe("contentTokens", () => {
	it("drops stop words and one-letter tokens and dedupes in order", () => {
		expect(contentTokens("Fill the PDF forms and save the PDF to a.txt")).toEqual([
			"fill",
			"pdf",
			"forms",
			"save",
			"txt",
		]);
	});
});
