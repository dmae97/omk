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

describe("independent trigger evidence", () => {
	/**
	 * Offline labelled-corpus A/B (54 entries): occurrence counts and boolean
	 * keywords both had 53/54 single-line accuracy. With each request duplicated,
	 * counted keywords flipped 2 routes and fell to 51/54; boolean keywords
	 * flipped none and stayed 53/54. Repetition is therefore not new evidence.
	 */
	it("duplicating a request does not move the route or its score", () => {
		const task = "write unit tests for the auth module";
		const once = routeDomain({ task });
		const twice = routeDomain({ task: `${task} ${task}` });

		expect(twice.primary.id).toBe(once.primary.id);
		expect(twice.confidence).toBe(once.confidence);
		expect(twice.scores).toEqual(once.scores);
	});
});
