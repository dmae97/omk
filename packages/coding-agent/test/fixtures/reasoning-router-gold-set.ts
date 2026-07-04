/**
 * Synthetic gold set for the Reasoning-Effort Router v2 (Goal 004, Req 3 / Lane I-goldset).
 *
 * Pure data fixture, self-contained: NO imports from src/. The TaskClass and
 * ThinkingLevel unions below are local aliases kept in sync with
 * `packages/coding-agent/src/core/reasoning-router.ts` (TaskClass) and the
 * `omk-agent-core` ThinkingLevel ladder on purpose, so this file can be consumed
 * by the eval harness (Lane I5) without pulling router internals into the
 * fixtures layer.
 *
 * Ground-truth policy:
 * - `expectedClass` is the human-judged ideal task class.
 * - `expectedLevel` is the human-judged ideal ThinkingLevel assuming a FULL
 *   capability ladder (`minimal < low < medium < high < xhigh < max`). It mostly
 *   mirrors the v1 rule table but deviates where a human would clearly want more
 *   or less effort, so the level-distance metric is independently meaningful
 *   (separates "classifier wrong" from "rule-table wrong").
 * - `holdout === true` marks the ~20% frozen holdout (6 per class = 42 total).
 *   Tuning (Lane A) looks only at non-holdout failures; the ship gate runs on
 *   the full set.
 *
 * Every prompt is synthetic and written from scratch. No real session text,
 * user names, repo paths, tokens, or URLs. See
 * `.omk/goals/004-reasoning-router-v2-plan/laneD-evaluation.md` section 1 and
 * `specs/004-reasoning-router-v2/spec.md` Requirement 3.
 *
 * Coverage by class (30 each): trivial, simple-edit, code-gen, debug, refactor,
 * review, plan. Edge cases included: empty/whitespace prompt, long prose
 * (>=2400 chars), raw diff markers (`diff --git` / `@@ ... @@`), code fences,
 * stack traces / tracebacks / panics, and multi-keyword precedence traps
 * (notably gold-0031 "fix the typo in the README title" -> simple-edit, the v1
 * regression case fixed by Req 1.3).
 */

export const GOLD_SET_VERSION = 1;

/** Local alias of the router TaskClass union. Self-contained: do not import from src/. */
export type GoldTaskClass = "trivial" | "simple-edit" | "code-gen" | "debug" | "refactor" | "review" | "plan";

/** Local alias of the ThinkingLevel ladder, low -> high. Self-contained. */
export type GoldThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Deterministic split bucket assigned by `computeGoldSetSplit` (Goal 009 Req 1 / Lane E). */
export type GoldSplit = "train" | "dev" | "holdout";

/**
 * Coarse stratification tag. "core" rows exercise a class's typical signal;
 * "edge-case" rows are the deliberately tricky ones already documented above
 * (empty/whitespace prompts, code fences, raw diff markers, stack
 * traces/tracebacks/panics, long prose briefs, and multi-keyword precedence
 * traps). Every edge-case id is enumerated explicitly in
 * `EDGE_CASE_FEATURE_TAGS` below; nothing is inferred from prompt content at
 * report time.
 */
export type GoldCategory = "core" | "edge-case";

/**
 * Closed, bounded set of surface-feature tags. Tags describe prompt *shape*
 * (never content), so they are safe to aggregate/log without leaking prompt
 * text.
 */
export type GoldFeatureTag =
	| "empty-prompt"
	| "whitespace-only"
	| "code-fence"
	| "diff-marker"
	| "stack-trace"
	| "long-prose"
	| "precedence-trap";

/** Fixed iteration order over the class union (matches `TaskClass` in `src/core/reasoning-router.ts`). */
export const GOLD_TASK_CLASSES: readonly GoldTaskClass[] = [
	"trivial",
	"simple-edit",
	"code-gen",
	"debug",
	"refactor",
	"review",
	"plan",
];

export interface GoldEntry {
	id: string;
	prompt: string;
	expectedClass: GoldTaskClass;
	expectedLevel: GoldThinkingLevel;
	holdout: boolean;
	/** Deterministic train/dev/holdout bucket; see `computeGoldSetSplit`. */
	split: GoldSplit;
	/** Coarse stratification; see `GoldCategory`. */
	category: GoldCategory;
	/** Closed, bounded surface-feature tags; see `GoldFeatureTag`. Empty for plain "core" rows. */
	featureTags: readonly GoldFeatureTag[];
	/** Ground-truth label schema version for this row. Pinned to `GOLD_SET_VERSION` for the initial labeling pass. */
	labelVersion: number;
	/** Optional external adjudication reference (e.g. an issue/PR id). Unset for the initial synthetic labeling pass. */
	adjudicationRef?: string;
}

/** The five original hand-authored fields, before additive split/category/tag/version metadata is computed. */
export type RawGoldEntry = Pick<GoldEntry, "id" | "prompt" | "expectedClass" | "expectedLevel" | "holdout">;

const RAW_GOLD_ENTRIES: readonly RawGoldEntry[] = [
	// ===== trivial (gold-0001 .. gold-0030) — short / one-word / empty-ish =====
	{ id: "gold-0001", prompt: "ok", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0002", prompt: "hello", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0003", prompt: "thanks", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0004", prompt: "hi", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0005", prompt: "done", expectedClass: "trivial", expectedLevel: "minimal", holdout: true },
	{ id: "gold-0006", prompt: "yes", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0007", prompt: "no", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0008", prompt: "next", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0009", prompt: "continue", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0010", prompt: "stop", expectedClass: "trivial", expectedLevel: "minimal", holdout: true },
	{ id: "gold-0011", prompt: "quit", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0012", prompt: "hey there", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0013", prompt: "sure", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0014", prompt: "got it", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0015", prompt: "agreed", expectedClass: "trivial", expectedLevel: "minimal", holdout: true },
	{ id: "gold-0016", prompt: "understood", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0017", prompt: "will do", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0018", prompt: "ok thanks", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0019", prompt: "hm", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0020", prompt: "cool", expectedClass: "trivial", expectedLevel: "minimal", holdout: true },
	{ id: "gold-0021", prompt: "ready", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0022", prompt: "wait", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0023", prompt: "yep", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0024", prompt: "nah", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0025", prompt: "nice", expectedClass: "trivial", expectedLevel: "minimal", holdout: true },
	{ id: "gold-0026", prompt: "fine", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0027", prompt: "ack", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0028", prompt: "pls", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0029", prompt: " ", expectedClass: "trivial", expectedLevel: "minimal", holdout: false },
	{ id: "gold-0030", prompt: "", expectedClass: "trivial", expectedLevel: "minimal", holdout: true },

	// ===== simple-edit (gold-0031 .. gold-0060) — typos / bumps / reword =====
	// gold-0031 is the v1 regression case: v1 routes "fix the typo" -> debug
	// (debug keyword precedes simple-edit); gold label is simple-edit (Req 1.3).
	{
		id: "gold-0031",
		prompt: "fix the typo in the README title",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0032",
		prompt: "fix a typo in the docs",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0033",
		prompt: "correct the spelling of 'recieve' to 'receive'",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0034",
		prompt: "bump the version to 1.2.3",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0035",
		prompt: "bump dependencies",
		expectedClass: "simple-edit",
		expectedLevel: "medium",
		holdout: true,
	},
	{
		id: "gold-0036",
		prompt: "reword the warning message",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0037",
		prompt: "tweak the button label copy",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0038",
		prompt: "fix the punctuation in the error message",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0039",
		prompt: "adjust the indentation in the config",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0040",
		prompt: "trim trailing whitespace",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: true,
	},
	{
		id: "gold-0041",
		prompt: "change the one-liner to use camelCase",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0042",
		prompt: "add a missing comma",
		expectedClass: "simple-edit",
		expectedLevel: "minimal",
		holdout: false,
	},
	{
		id: "gold-0043",
		prompt: "fix a missing semicolon",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0044",
		prompt: "update the copyright year",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0045",
		prompt: "reword the changelog entry",
		expectedClass: "simple-edit",
		expectedLevel: "medium",
		holdout: true,
	},
	{
		id: "gold-0046",
		prompt: "tweak the margin in the css",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0047",
		prompt: "bump the patch version",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0048",
		prompt: "correct a grammar mistake in the comment",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0049",
		prompt: "swap two words in the headline",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0050",
		prompt: "fix the capitalization of the title",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: true,
	},
	{
		id: "gold-0051",
		prompt: "add a period at the end of the sentence",
		expectedClass: "simple-edit",
		expectedLevel: "minimal",
		holdout: false,
	},
	{
		id: "gold-0052",
		prompt: "remove a stray double space",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0053",
		prompt: "update the author email",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0054",
		prompt: "tweak the placeholder text",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0055",
		prompt: "correct the date format",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: true,
	},
	{
		id: "gold-0056",
		prompt: "bump the node version in the ci matrix",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0057",
		prompt: "fix the typo: 'gte' should be 'get'",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0058",
		prompt: "reword the tooltip text",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0059",
		prompt: "add a missing closing html tag",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0060",
		prompt: "adjust the table alignment",
		expectedClass: "simple-edit",
		expectedLevel: "low",
		holdout: true,
	},

	// ===== code-gen (gold-0061 .. gold-0090) — implement / create / code fences / diffs =====
	{
		id: "gold-0061",
		prompt: "implement a binary search function",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0062",
		prompt: "write a function to reverse a string",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0063",
		prompt: "create a new react component for the user avatar",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0064",
		prompt: "add a debounce utility to the utils folder",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0065",
		prompt: "build a small cli to convert csv to json",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: true,
	},
	// gold-0066: code-fence edge case, no instruction keyword -> fence signal -> code-gen.
	{
		id: "gold-0066",
		prompt: "```\nconst x = compute();\n```",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	// gold-0067: raw diff edge case, no instruction keyword -> diff-marker signal -> code-gen.
	{
		id: "gold-0067",
		prompt:
			"diff --git a/foo.ts b/foo.ts\nindex 111..222 100644\n--- a/foo.ts\n+++ b/foo.ts\n@@ -1,3 +1,4 @@\n import a\n+import b\n import c",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0068",
		prompt: "generate a uuid helper",
		expectedClass: "code-gen",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0069",
		prompt: "scaffold a new page at /dashboard",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0070",
		prompt: "add a POST endpoint for password reset",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: true,
	},
	{
		id: "gold-0071",
		prompt: "write a unit test for the parser",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0072",
		prompt: "implement the oauth2 flow",
		expectedClass: "code-gen",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0073",
		prompt: "create a TypeScript type for the api response",
		expectedClass: "code-gen",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0074",
		prompt: "add input validation to the form",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0075",
		prompt: "write a sql migration to add the email column",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: true,
	},
	{
		id: "gold-0076",
		prompt: "build a webhook handler for stripe events",
		expectedClass: "code-gen",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0077",
		prompt: "generate mock data for the dashboard",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0078",
		prompt: "add error handling to the fetch call",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0079",
		prompt: "implement caching for the user profile",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0080",
		prompt: "create a custom hook for dark mode",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: true,
	},
	{
		id: "gold-0081",
		prompt: "write a recursive directory walker",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0082",
		prompt: "add a retry mechanism to the http client",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0083",
		prompt: "implement a rate limiter using a token bucket",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0084",
		prompt: "build a pagination component",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0085",
		prompt: "create a factory function for the widgets",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: true,
	},
	{
		id: "gold-0086",
		prompt: "add jwt authentication to the express app",
		expectedClass: "code-gen",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0087",
		prompt: "write a memoized fibonacci",
		expectedClass: "code-gen",
		expectedLevel: "low",
		holdout: false,
	},
	{
		id: "gold-0088",
		prompt: "implement a bloom filter",
		expectedClass: "code-gen",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0089",
		prompt: "scaffold a vitest config",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0090",
		prompt: "create a middleware that logs requests",
		expectedClass: "code-gen",
		expectedLevel: "medium",
		holdout: true,
	},

	// ===== debug (gold-0091 .. gold-0120) — errors / crashes / tracebacks =====
	{
		id: "gold-0091",
		prompt: "fix the null pointer exception in the user service",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0092",
		prompt: "the app crashes on startup with a segfault",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	// gold-0093: traceback edge case (TypeError stack trace).
	{
		id: "gold-0093",
		prompt:
			"fix this traceback:\nTypeError: Cannot read properties of undefined (reading 'map')\n    at UserList.render (UserList.tsx:42)\n    at renderWithHooks (react-reconciler.js:1203)",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0094",
		prompt: "debug the memory leak in the worker pool",
		expectedClass: "debug",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0095",
		prompt: "the tests are flaky on CI but pass locally",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: true,
	},
	{
		id: "gold-0096",
		prompt: "fix the race condition in the websocket handler",
		expectedClass: "debug",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0097",
		prompt: "investigate why the build is failing",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	// gold-0098: error-trace edge case.
	{
		id: "gold-0098",
		prompt:
			"fix this error:\nError: listen EADDRINUSE :::3000\n    at Server.setupListenHandle [as listen] (node:net:1820)\n    at Server.listen (node:net:1909)",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0099",
		prompt: "the date picker throws an error on invalid input",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0100",
		prompt: "reproduce the off-by-one in the pagination",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: true,
	},
	{
		id: "gold-0101",
		prompt: "the production server fails with a 500 on login",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0102",
		prompt: "debug the infinite loop in the render cycle",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0103",
		prompt: "fix the heap overflow in the c extension",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0104",
		prompt: "the cron job silently fails at midnight",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0105",
		prompt: "stack trace shows a null deref in parser.parse",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: true,
	},
	{
		id: "gold-0106",
		prompt: "the regression was introduced in the last commit",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0107",
		prompt: "debug the deadlock in the mutex",
		expectedClass: "debug",
		expectedLevel: "max",
		holdout: false,
	},
	{
		id: "gold-0108",
		prompt: "the container crashes and exits with code 137",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0109",
		prompt: "fix the assertion error in the snapshot test",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0110",
		prompt: "debug the request timeout: it hangs for 30s then fails",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: true,
	},
	{
		id: "gold-0111",
		prompt: "debug the data corruption in the queue",
		expectedClass: "debug",
		expectedLevel: "max",
		holdout: false,
	},
	{
		id: "gold-0112",
		prompt: "the import fails with a circular dependency error",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0113",
		prompt: "fix the encoding bug in the csv parser",
		expectedClass: "debug",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0114",
		prompt: "the worker crashes under high load",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	// gold-0115: go panic stack-trace edge case (holdout).
	{
		id: "gold-0115",
		prompt:
			"fix this panic:\npanic: runtime error: index out of range [5] with length 3\ngoroutine 1 [running]:\nmain.main()\n        /app/main.go:23 +0x1a0",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: true,
	},
	{
		id: "gold-0116",
		prompt: "debug the fuzzy matcher returning wrong results",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0117",
		prompt: "the migration rolls back halfway then errors",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0118",
		prompt: "fix the use-after-free in the destructor",
		expectedClass: "debug",
		expectedLevel: "max",
		holdout: false,
	},
	{
		id: "gold-0119",
		prompt: "the jwt verification fails intermittently",
		expectedClass: "debug",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0120",
		prompt: "debug why the cache returns stale data",
		expectedClass: "debug",
		expectedLevel: "medium",
		holdout: true,
	},

	// ===== refactor (gold-0121 .. gold-0150) — extract / rename / cleanup =====
	{
		id: "gold-0121",
		prompt: "extract the validation logic into its own module",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0122",
		prompt: "rename the function doStuff to processOrder",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0123",
		prompt: "clean up the dead code in the utils",
		expectedClass: "refactor",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0124",
		prompt: "simplify the nested if-else chain",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0125",
		prompt: "deduplicate the repeated error handling",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: true,
	},
	{
		id: "gold-0126",
		prompt: "reorganize the folder structure by feature",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0127",
		prompt: "modularize the monolithic app.ts",
		expectedClass: "refactor",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0128",
		prompt: "refactor the god class into smaller services",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0129",
		prompt: "extract a reusable hook from the component",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0130",
		prompt: "rename the misnamed variables throughout the codebase",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: true,
	},
	{
		id: "gold-0131",
		prompt: "clean up the commented-out code",
		expectedClass: "refactor",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0132",
		prompt: "simplify the over-engineered factory",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0133",
		prompt: "deduplicate the three near-identical parsers",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0134",
		prompt: "restructure the data layer",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0135",
		prompt: "refactor for readability without changing behavior",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: true,
	},
	{
		id: "gold-0136",
		prompt: "consolidate the config files",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0137",
		prompt: "extract method: move the loop body out",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0138",
		prompt: "rename the db column and update callers",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0139",
		prompt: "clean up the todos in the codebase",
		expectedClass: "refactor",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0140",
		prompt: "simplify the regex to be more readable",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: true,
	},
	{
		id: "gold-0141",
		prompt: "reorganize the exports for tree-shaking",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0142",
		prompt: "modularize the giant css file",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0143",
		prompt: "refactor the callback hell into async await",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0144",
		prompt: "deduplicate the test fixtures",
		expectedClass: "refactor",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0145",
		prompt: "extract the business rules into a rules engine",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: true,
	},
	{
		id: "gold-0146",
		prompt: "rename the package and update all imports",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0147",
		prompt: "clean up the eslint disable comments",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0148",
		prompt: "simplify the state machine",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0149",
		prompt: "refactor to use the strategy pattern",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0150",
		prompt: "consolidate the duplicate api calls",
		expectedClass: "refactor",
		expectedLevel: "high",
		holdout: true,
	},

	// ===== review (gold-0151 .. gold-0180) — audit / critique / assess =====
	{
		id: "gold-0151",
		prompt: "review this pull request for correctness",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0152",
		prompt: "audit the codebase for accessibility issues",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0153",
		prompt: "critique the api design",
		expectedClass: "review",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0154",
		prompt: "assess the security posture of the auth module",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0155",
		prompt: "inspect the sql queries for n+1 problems",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: true,
	},
	// gold-0156: precedence trap. "regressions" is a debug keyword that precedes
	// review in v1, so v1 -> debug; gold label is review.
	{
		id: "gold-0156",
		prompt: "review the diff for any regressions",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0157",
		prompt: "audit the dependencies for known vulnerabilities",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0158",
		prompt: "lgtm, just double-check the tests",
		expectedClass: "review",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0159",
		prompt: "approve the merge after review",
		expectedClass: "review",
		expectedLevel: "medium",
		holdout: false,
	},
	// gold-0160: precedence trap. "error handling" is a debug signal; gold is review.
	{
		id: "gold-0160",
		prompt: "review the error handling strategy",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: true,
	},
	{
		id: "gold-0161",
		prompt: "critique the database schema design",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0162",
		prompt: "assess the performance characteristics",
		expectedClass: "review",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0163",
		prompt: "inspect the bundle for large dependencies",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0164",
		prompt: "review the licensing of third-party libs",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0165",
		prompt: "audit the logging for sensitive data leaks",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: true,
	},
	{
		id: "gold-0166",
		prompt: "review the concurrency model for deadlocks",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0167",
		prompt: "critique the test coverage",
		expectedClass: "review",
		expectedLevel: "medium",
		holdout: false,
	},
	// gold-0168: precedence overlap. "plan" is a plan keyword but review precedes
	// plan in v1; both v1 and gold land on review.
	{
		id: "gold-0168",
		prompt: "assess the migration plan for risks",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0169",
		prompt: "inspect the dockerfile for best practices",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{ id: "gold-0170", prompt: "review the ci pipeline", expectedClass: "review", expectedLevel: "high", holdout: true },
	{
		id: "gold-0171",
		prompt: "audit the secrets handling",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0172",
		prompt: "review the public api for breaking changes",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0173",
		prompt: "critique the naming conventions",
		expectedClass: "review",
		expectedLevel: "medium",
		holdout: false,
	},
	// gold-0174: precedence trap. "fix" is a debug keyword that precedes review.
	{
		id: "gold-0174",
		prompt: "review the fix before merging",
		expectedClass: "review",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0175",
		prompt: "inspect the memory usage profile",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: true,
	},
	{
		id: "gold-0176",
		prompt: "review the threat model",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0177",
		prompt: "audit the access control lists",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	{
		id: "gold-0178",
		prompt: "review the retry logic for edge cases",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: false,
	},
	// gold-0179: precedence trap. "error messages" is a debug signal; gold is review.
	{
		id: "gold-0179",
		prompt: "critique the error messages for clarity",
		expectedClass: "review",
		expectedLevel: "medium",
		holdout: false,
	},
	{
		id: "gold-0180",
		prompt: "review the open api spec for consistency",
		expectedClass: "review",
		expectedLevel: "high",
		holdout: true,
	},

	// ===== plan (gold-0181 .. gold-0210) — design / architect / roadmap =====
	// Three entries (gold-0208, gold-0209, gold-0210) are deliberately long
	// prose briefs (>=2400 chars) exercising the COMPLEX_PROSE_MIN_CHARS path.
	{
		id: "gold-0181",
		prompt: "plan the migration from rest to graphql",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0182",
		prompt: "design the authentication architecture for the platform",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0183",
		prompt: "architect a multi-tenant data model",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	// gold-0184: overlap. "create" is a code-gen keyword but plan precedes code-gen.
	{
		id: "gold-0184",
		prompt: "create a roadmap for the v2 launch",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0185",
		prompt: "write a spec for the new billing feature",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: true,
	},
	{
		id: "gold-0186",
		prompt: "design the caching strategy for the read-heavy api",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0187",
		prompt: "architect the event-driven system",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0188",
		prompt: "plan the decomposition of the monolith into services",
		expectedClass: "plan",
		expectedLevel: "max",
		holdout: false,
	},
	{
		id: "gold-0189",
		prompt: "design the ci/cd pipeline from scratch",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0190",
		prompt: "create a strategy for the zero-downtime deployment",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: true,
	},
	{
		id: "gold-0191",
		prompt: "architect the realtime collaboration layer",
		expectedClass: "plan",
		expectedLevel: "max",
		holdout: false,
	},
	{
		id: "gold-0192",
		prompt: "plan the database sharding strategy",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0193",
		prompt: "design the observability stack (logs, metrics, traces)",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0194",
		prompt: "write a technical spec for the search infrastructure",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0195",
		prompt: "architect the permission system",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: true,
	},
	{
		id: "gold-0196",
		prompt: "plan the sdk for third-party developers",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0197",
		prompt: "design the webhook delivery system with retries",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0198",
		prompt: "architect the multi-region failover",
		expectedClass: "plan",
		expectedLevel: "max",
		holdout: false,
	},
	{
		id: "gold-0199",
		prompt: "plan the migration off the legacy queue",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0200",
		prompt: "design the feature flag system",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: true,
	},
	{
		id: "gold-0201",
		prompt: "decompose the reporting module into services",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0202",
		prompt: "architect the data warehouse schema",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0203",
		prompt: "plan the api versioning strategy",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0204",
		prompt: "design the rate limiting architecture",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0205",
		prompt: "architect the file upload pipeline",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: true,
	},
	{
		id: "gold-0206",
		prompt: "plan the rollout strategy for the new engine",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	{
		id: "gold-0207",
		prompt: "design the audit log architecture",
		expectedClass: "plan",
		expectedLevel: "xhigh",
		holdout: false,
	},
	// gold-0208: long prose brief (>=2400 chars). Template literal preserves real newlines.
	{
		id: "gold-0208",
		prompt: `Design and plan the architecture for a multi-tenant SaaS platform that combines usage-based metered billing, subscription lifecycle management, and a configurable notifications service. Context and constraints: we expect roughly 40k tenants spanning self-serve free tier accounts up to enterprise contracts with custom pricing. Ingestion of usage events peaks at around 12k events per second during weekday business hours in the US and EU regions, and events arrive through three paths: a public REST ingestion api, a streaming kafka topic fed by our own product services, and a periodic bulk drop for historical backfill. Each usage event must be deduplicated by an idempotency key, validated against the tenant contract in force at the event timestamp because contracts can change mid-cycle, and aggregated into hourly meter buckets that feed both the invoice line-item generator and a real-time spend dashboard.

The billing engine must support proration, tiered overage rates, minimum commit drawdowns, prepaid credit wallets, and tax determination through an external provider. Invoicing runs nightly per timezone bucket and must be idempotent and replayable. The notifications service lets tenants configure channel policies (email, in-app, webhook, slack) keyed off event types and spend thresholds; a threshold rule engine evaluates metered spend against tenant limits every minute and must not duplicate alerts within a cooldown window.

Cross-cutting requirements: strict tenant isolation at the storage layer (row-level security or schema-per-tenant, with your recommendation), a per-tenant rate limit, a complete compliance trail of every pricing decision and notification dispatch for SOC2, and a four-eyes approval gate for any contract change affecting enterprise tenants. We run on a managed kubernetes cluster across two regions with a follow-the-sun failover policy. Latency budget for the public ingestion api is p99 under 120ms. Budget for the spend dashboard query is p99 under 400ms.

Deliver: a component diagram, the data model for contracts, meters, wallets, invoices, and notifications, the event-driven flow from ingestion to invoice, the consistency boundaries and transaction strategy, the idempotency and replay mechanisms, the multi-region topology with failover, the security and isolation model, the observability surfaces (logs, metrics, traces, slos), the rollout plan to migrate from the existing legacy single-region monolith, and the top ten risks with mitigations. Prefer boring, well-understood technologies where possible. Call out every place we are accepting a consistency or availability tradeoff and why. Keep the design extensible for a future contract-pricing dsl without building that dsl now.`,
		expectedClass: "plan",
		expectedLevel: "max",
		holdout: false,
	},
	// gold-0209: long prose brief (>=2400 chars).
	{
		id: "gold-0209",
		prompt: `Plan the end-to-end migration of our legacy Rails monolith into an event-driven services architecture using the strangler fig pattern, executed over five quarters without a big-bang cutover and without any customer-visible downtime. Starting state: a single 380k-line Rails app backed by one large postgres database, with sidekiq for background jobs and a tightly coupled domain model spanning billing, inventory, orders, fulfillment, and notifications. Pain points we must address: deploys are risky and batched, the test suite takes 47 minutes, on-call rotates among engineers who cannot safely reason about cross-domain change risk, and the team has grown to 22 engineers stepping on each other.

Target state: bounded contexts identified via event-storming, each context owning its service, its database or schema, and its public contract. Services communicate via asynchronous domain events on an event bus and via synchronous requests only where a hard read-time consistency requirement is documented. The migration sequence must be dependency-aware: start with the notifications context (fewest inbound dependencies), then billing, then inventory, then orders, then fulfillment. For each wave we must define the seam (the interface where we divert traffic), the data sync strategy (dual-write, change-data-capture, or backfill-and-cut), the rollback plan, and the success criteria.

We must address the hard problems explicitly: distributed transactions vs saga with compensating actions, the outbox pattern for reliable event publishing, schema evolution and consumer-driven contract tests, idempotent consumers, event schema versioning with a registry, exactly-once vs at-least-once semantics per consumer, and a replay capability for event reprocessing. Observability: distributed tracing across the bus, per-service error budgets, a single pane for cross-service dependency maps, and runbooks generated from the same trace data. The data plane must keep the legacy monolith and the new services consistent during the overlap window, which may be two quarters for any given context.

Team and governance: a platform team owns the bus, contracts, and paved-road tooling; stream-aligned teams own each context. We need an architecture governance council with a lightweight proposal process for cross-cutting decisions, a migration tracking dashboard showing strangled percentage per route, and a policy of deferring irreversible decisions to the last responsible moment. Compliance: we are SOC2 and must keep the compliance trail continuous across the migration; every cut-over must record the switchover event and the data reconciliation proof.

Deliver: the bounded context map, the event catalog with schemas, the migration wave plan with dependencies, the data sync and reconciliation strategy per wave, the rollback runbooks, the observability plan, the team topologies and governance model, a quarter-by-quarter milestone roadmap with explicit go/no-go gates, the top risks with mitigations, and a definition of done for declaring the monolith fully retired. Be honest about which problems we are deferring and why.`,
		expectedClass: "plan",
		expectedLevel: "max",
		holdout: false,
	},
	// gold-0210: long prose brief (>=2400 chars). Holdout.
	{
		id: "gold-0210",
		prompt: `Architect a realtime collaborative document editor supporting concurrent editing by up to 200 participants per document, operational across regions, with sub-100ms perceived latency for local edits and conflict-free convergence. The editor must support rich text (headings, lists, tables, embedded images, code blocks with syntax highlighting, comments, and suggestions), presence (cursors and selections with user identity and color), and offline editing with merge-on-reconnect from mobile clients on flaky networks.

Core decision: choose between crdt and ot, justify the choice, and specify the data structure. We lean toward a crdt library for the document model but need your analysis of memory footprint at scale, the garbage collection of deleted tombstones, and the snapshot and rehydration strategy for documents exceeding 5mb of operational history. The transport layer must support a websocket primary transport with a sse fallback, binary framing for bandwidth efficiency, and a relay service that fans out updates to all participants in a room with per-room sharding and sticky routing.

Persistence: every operation is appended to an append-only operation log, periodic snapshots compact the log, and the document state is materialized for read-after-write consistency and for offline reconnection catch-up. We need a strategy for active-active multi-region rooms, including last-writer-winning at the metadata level, a tie-breaker for simultaneous cursors, and a conflict policy for embedded comment threads that does not lose user attributions. The system must survive a region failure mid-session with session migration and no lost edits.

Scaling and reliability: per-room process pinning, backpressure on slow consumers, heartbeat and idle session reaping, a presence fan-out budget per room, and graceful degradation when a room exceeds the participant cap by switching overflow viewers to read-only polling. Observability: per-room latency p50, p95, and p99, fan-out lag, crdt merge conflict rate, reconnection success rate, and offline-merge success rate. Security: end-to-end authorization on every operation, per-document acl checks, rate limiting, and abuse detection for anomalous edit velocity.

Deliver: the architecture diagram, the crdt vs ot analysis and decision, the operation and snapshot data models, the transport and relay topology with sharding, the persistence and compaction strategy, the multi-region active-active design with session migration, the scaling and backpressure plan, the observability surfaces and slos, the security model, a capacity planning model for peak load, the top ten risks with mitigations, and a phased delivery plan that gets us to a closed beta in one quarter. Identify every assumption that, if wrong, changes the architecture materially.`,
		expectedClass: "plan",
		expectedLevel: "max",
		holdout: true,
	},
];

/**
 * Explicit id -> feature-tag lookup for the deliberately-tricky rows already
 * documented above (empty/whitespace prompts, code fences, raw diff markers,
 * stack traces/tracebacks/panics, long prose briefs, and multi-keyword
 * precedence traps). Ids not listed here default to category "core" with no
 * feature tags. Kept as an explicit table (not inferred from prompt content)
 * so tagging stays reviewable and stable across future edits.
 */
const EDGE_CASE_FEATURE_TAGS: Readonly<Record<string, readonly GoldFeatureTag[]>> = {
	"gold-0029": ["whitespace-only"],
	"gold-0030": ["empty-prompt"],
	"gold-0031": ["precedence-trap"],
	"gold-0066": ["code-fence"],
	"gold-0067": ["diff-marker"],
	"gold-0093": ["stack-trace"],
	"gold-0098": ["stack-trace"],
	"gold-0115": ["stack-trace"],
	"gold-0156": ["precedence-trap"],
	"gold-0160": ["precedence-trap"],
	"gold-0168": ["precedence-trap"],
	"gold-0174": ["precedence-trap"],
	"gold-0179": ["precedence-trap"],
	"gold-0184": ["precedence-trap"],
	"gold-0208": ["long-prose"],
	"gold-0209": ["long-prose"],
	"gold-0210": ["long-prose"],
};

/** Category + feature tags for one id; "core"/[] unless explicitly listed above. */
function categorizeEntry(id: string): Pick<GoldEntry, "category" | "featureTags"> {
	const featureTags = EDGE_CASE_FEATURE_TAGS[id];
	if (!featureTags) return { category: "core", featureTags: [] };
	return { category: "edge-case", featureTags };
}

/**
 * Deterministic train/dev/holdout split (Goal 009 Req 1 / Lane E).
 *
 * Rule: an entry whose `holdout` is already `true` stays in the "holdout"
 * bucket (the existing frozen ~20% ship gate is untouched). For the remaining
 * non-holdout rows, group by `expectedClass`, sort each group by `id`
 * ascending, then walk the sorted group in order: position `p` (0-indexed) is
 * "dev" when `p % 4 === 3` (every 4th row), otherwise "train". With 24
 * non-holdout rows per class this yields exactly 6 dev + 18 train per class
 * (30/class total: 6 holdout + 6 dev + 18 train; 210 total: 42 + 42 + 126).
 *
 * Pure and deterministic: the same input always produces the same split, and
 * the split never depends on prompt content -- only on `id`, `expectedClass`,
 * and the existing `holdout` boolean. Exported for reuse/testing independent
 * of GOLD_SET itself.
 */
export function computeGoldSetSplit(
	entries: readonly Pick<GoldEntry, "id" | "expectedClass" | "holdout">[],
): ReadonlyMap<string, GoldSplit> {
	const split = new Map<string, GoldSplit>();
	const byClass = new Map<GoldTaskClass, Array<Pick<GoldEntry, "id" | "expectedClass" | "holdout">>>();

	for (const entry of entries) {
		if (entry.holdout) {
			split.set(entry.id, "holdout");
			continue;
		}
		const bucket = byClass.get(entry.expectedClass) ?? [];
		bucket.push(entry);
		byClass.set(entry.expectedClass, bucket);
	}

	for (const bucket of byClass.values()) {
		const sorted = [...bucket].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		sorted.forEach((entry, position) => {
			split.set(entry.id, position % 4 === 3 ? "dev" : "train");
		});
	}

	return split;
}

const SPLIT_BY_ID = computeGoldSetSplit(RAW_GOLD_ENTRIES);

/**
 * Full gold set with additive split/category/featureTags/labelVersion
 * metadata (Goal 009 Req 1 / Lane E). Every original id/prompt/expectedClass/
 * expectedLevel/holdout value from the Goal 004 hand-authored set above is
 * unchanged; this only attaches computed/derived fields on top.
 */
export const GOLD_SET: readonly GoldEntry[] = RAW_GOLD_ENTRIES.map((entry) => {
	const split = SPLIT_BY_ID.get(entry.id);
	if (!split) {
		throw new Error(`reasoning-router-gold-set: missing split assignment for id "${entry.id}"`);
	}
	return {
		...entry,
		...categorizeEntry(entry.id),
		split,
		labelVersion: GOLD_SET_VERSION,
	};
});

/** Per-split row counts. Numbers only -- never ids or prompt text. */
export interface GoldSplitCounts {
	readonly train: number;
	readonly dev: number;
	readonly holdout: number;
}

/** Aggregate split report: totals plus a per-class breakdown. Numbers only. */
export interface GoldSetSplitReport {
	readonly total: number;
	readonly overall: GoldSplitCounts;
	readonly perClass: Readonly<Record<GoldTaskClass, GoldSplitCounts>>;
}

const zeroSplitCounts = (): { train: number; dev: number; holdout: number } => ({ train: 0, dev: 0, holdout: 0 });

/**
 * Aggregate-only train/dev/holdout report (Goal 009 Req 1 / Lane E). Returns
 * counts ONLY: no ids, no prompt text, no per-row detail. Safe to print in CI
 * logs or governance dashboards without exposing the frozen holdout set or any
 * synthetic prompt content. Defaults to summarizing the full GOLD_SET.
 */
export function summarizeGoldSetSplit(entries: readonly GoldEntry[] = GOLD_SET): GoldSetSplitReport {
	const overall = zeroSplitCounts();
	const perClass = {} as Record<GoldTaskClass, { train: number; dev: number; holdout: number }>;
	for (const taskClass of GOLD_TASK_CLASSES) {
		perClass[taskClass] = zeroSplitCounts();
	}
	for (const entry of entries) {
		overall[entry.split] += 1;
		perClass[entry.expectedClass][entry.split] += 1;
	}
	return { total: entries.length, overall, perClass };
}
