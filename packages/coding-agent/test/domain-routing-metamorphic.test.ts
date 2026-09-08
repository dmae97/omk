import { describe, expect, it } from "vitest";
import { routeDomain } from "../src/core/domain-router.ts";

/**
 * Metamorphic relations for domain routing.
 *
 * The 54-entry corpus can only check inputs whose correct domain someone has
 * already labelled, and it is entirely single-line. These relations need no
 * label at all: they compare the router against itself on inputs that mean the
 * same thing, so a disagreement is a defect regardless of which domain is
 * "right".
 *
 * That is how the whitespace defect was found. 62 of the registry's 216
 * triggers hold a literal space — the keyword "unit test" and the regex
 * `\b(unit tests?|...)\b` alike — so they matched a single space and nothing
 * else. Agent prompts carry wrapped lines and pasted logs, and
 * "write unit tests for the auth module" routed to qa-testing on one line but
 * to backend-api once a newline fell between "unit" and "tests".
 */

const TASKS = [
	"fix the css bug in the react component",
	"optimize the sql query and add an index",
	"write unit tests for the auth module",
	"deploy the docker container to kubernetes",
	"the model overfits, tune the hyperparameters",
	"audit the endpoint for xss and csrf",
	"update the readme and changelog",
	"improve the ui api",
	"refactor the react component and the sql query",
	"visual qa on the landing page",
	"machine learning inference latency",
] as const;

const verdict = (task: string, tags: readonly string[] = []) => {
	const result = routeDomain({ task, tags: [...tags] });
	return `${result.primary.id}|${result.confidence}|${result.ambiguous}`;
};

describe("routing is invariant to meaning-preserving rewrites", () => {
	describe("whitespace", () => {
		const forms: readonly (readonly [string, (task: string) => string])[] = [
			["double space", (task) => task.replace(/ /g, "  ")],
			["newline", (task) => task.replace(/ /g, "\n")],
			["tab", (task) => task.replace(/ /g, "\t")],
			["mixed run", (task) => task.replace(/ /g, " \n  ")],
			["leading/trailing", (task) => `\n  ${task}  \n`],
		];

		for (const [label, rewrite] of forms) {
			it(`survives ${label}`, () => {
				const offenders = TASKS.filter((task) => verdict(rewrite(task)) !== verdict(task)).map(
					(task) => `"${task}": ${verdict(task)} -> ${verdict(rewrite(task))}`,
				);
				expect(offenders, `${offenders.length} routes changed under ${label}`).toEqual([]);
			});
		}

		it("keeps a multi-word trigger matching across a line break", () => {
			// The concrete regression: the QA trigger is the phrase "unit tests".
			expect(verdict("write unit tests for the auth module")).toBe(verdict("write unit\ntests for the auth module"));
		});
	});

	it("is unchanged by case", () => {
		const offenders = TASKS.filter((task) => verdict(task.toUpperCase()) !== verdict(task));
		expect(offenders).toEqual([]);
	});

	it("is unchanged by neutral filler", () => {
		const offenders = TASKS.filter(
			(task) => routeDomain({ task: `please ${task} thanks asap` }).primary.id !== routeDomain({ task }).primary.id,
		);
		expect(offenders).toEqual([]);
	});

	it("does not care whether a word arrives as a tag or in the task", () => {
		// routeDomain joins tags and task into one string, so the split must not matter.
		const offenders = TASKS.filter((task) => {
			const words = task.split(" ");
			return verdict(words.slice(1).join(" "), [words[0]]) !== verdict(task);
		});
		expect(offenders).toEqual([]);
	});
});

describe("known asymmetry: keyword triggers count, regex triggers do not", () => {
	/**
	 * `keywordMatcher` returns an occurrence count (capped at 3) while
	 * `regexMatcher` returns 0 or 1, so repeating a request inflates a domain
	 * scored by keywords and leaves a domain scored by regex flat. Whether the
	 * signal came from a keyword or a regex is an authoring detail of the
	 * registry, and it should not decide the route.
	 *
	 * Both repairs — counting regex hits, or making keywords boolean — change
	 * live routing, and the corpus holds no repeated-keyword entry to judge them
	 * against, so this documents the behaviour instead of asserting it is right.
	 * If a change makes this test fail, that is the decision being made: record
	 * the labelled evidence for it rather than updating the expectation.
	 */
	it("duplicating a request can move the route", () => {
		const task = "write unit tests for the auth module";
		const once = routeDomain({ task });
		const twice = routeDomain({ task: `${task} ${task}` });

		expect(once.primary.id).toBe("qa-testing");
		expect(twice.primary.id).toBe("backend-api");

		// The QA signal is a regex and does not grow; the backend signal is a
		// keyword and does.
		const qaOnce = once.scores.find((score) => score.id === "qa-testing")?.score;
		const qaTwice = twice.scores.find((score) => score.id === "qa-testing")?.score;
		expect(qaTwice).toBe(qaOnce);

		const backendOnce = once.scores.find((score) => score.id === "backend-api")?.score ?? 0;
		const backendTwice = twice.scores.find((score) => score.id === "backend-api")?.score ?? 0;
		expect(backendTwice).toBeGreaterThan(backendOnce);
	});
});
