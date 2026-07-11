/**
 * Governed synthetic generalization set for Reasoning Router v4.
 *
 * Self-contained fixture: NO imports from src/. All prompts are synthetic and
 * intentionally avoid real session text, names, repo paths, URLs, credentials,
 * or private identifiers. The row text is held in this fixture for local test
 * execution only; governance reports aggregate by class/category/feature tag.
 *
 * allow: SIZE_OK — governed 420-row pure-data fixture; one row per corpus case.
 */

export const GENERALIZATION_SET_VERSION = 1;
export const GENERALIZATION_PRIOR_TOTAL_ROWS = 210;
export const GENERALIZATION_PRIOR_ROWS_PER_CLASS = 30;
export const GENERALIZATION_TARGET_ROWS_PER_CLASS = 60;
export const GENERALIZATION_EXPANSION_ROWS_PER_CLASS = 30;
export const GENERALIZATION_WAVE1_PRIOR_TOTAL_ROWS = 315;
export const GENERALIZATION_WAVE1_PRIOR_ROWS_PER_CLASS = 45;
export const GENERALIZATION_WAVE1_SLICE_ROWS_PER_CLASS = 15;
export const GENERALIZATION_PRIOR_FINGERPRINT = "ffa72e9a";
export const GENERALIZATION_WAVE1_PRIOR_FINGERPRINT = "959e4d2a";
export const GENERALIZATION_HOLDOUT_MIN_RATIO = 0.2;
export const GENERALIZATION_HOLDOUT_MAX_RATIO = 0.25;
export const GENERALIZATION_EXTENSIBLE = true;

/** Local alias of the router TaskClass union. Self-contained: do not import from src/. */
export type GeneralizationTaskClass = "trivial" | "simple-edit" | "code-gen" | "debug" | "refactor" | "review" | "plan";

/** Local alias of the ThinkingLevel ladder, low -> high. Self-contained. */
export type GeneralizationThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Deterministic content-blind split bucket. Prompt text never affects this value. */
export type GeneralizationSplit = "train" | "dev" | "holdout";

export const GENERALIZATION_SPLITS: readonly GeneralizationSplit[] = ["train", "dev", "holdout"];

export type GeneralizationCategory =
	| "paraphrase"
	| "negation"
	| "compound"
	| "precedence"
	| "multilingual"
	| "fallback-shape"
	| "morphology"
	| "mixed";

export const GENERALIZATION_FEATURE_TAGS = [
	"verb-synonym",
	"noun-synonym",
	"negation-preposed",
	"negation-postposed-ko",
	"double-negation",
	"compound-leading-intent",
	"compound-secondary-intent",
	"precedence-trap",
	"multilingual-ko",
	"short-ko-task-signal",
	"long-brief-shape",
	"fallback-zero-score",
	"code-shape-signal",
	"diff-shape-signal",
	"release-runbook",
	"low-edit-risk",
	"review-vs-codegen",
	"debug-vs-review",
	"plan-vs-codegen",
	"refactor-vs-debug",
] as const;

export type GeneralizationFeatureTag = (typeof GENERALIZATION_FEATURE_TAGS)[number];

export const GENERALIZATION_TASK_CLASSES: readonly GeneralizationTaskClass[] = [
	"trivial",
	"simple-edit",
	"code-gen",
	"debug",
	"refactor",
	"review",
	"plan",
];

const GENERALIZATION_CLASS_LEVELS: Readonly<Record<GeneralizationTaskClass, GeneralizationThinkingLevel>> = {
	trivial: "minimal",
	"simple-edit": "low",
	"code-gen": "medium",
	debug: "high",
	refactor: "high",
	review: "high",
	plan: "xhigh",
};

export interface GeneralizationEntry {
	readonly id: string;
	readonly prompt: string;
	readonly expectedClass: GeneralizationTaskClass;
	readonly expectedLevel: GeneralizationThinkingLevel;
	readonly split: GeneralizationSplit;
	readonly category: GeneralizationCategory;
	readonly featureTags: readonly GeneralizationFeatureTag[];
	readonly labelVersion: number;
	readonly adjudicationRef?: string;
}

interface GeneralizationSeed {
	readonly prompt: string;
	readonly category: GeneralizationCategory;
	readonly featureTags: readonly GeneralizationFeatureTag[];
}

const GENERALIZATION_BASE_CASES_BY_CLASS = {
	trivial: [
		{ prompt: "yep, that's fine", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "sounds reasonable", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "go ahead", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "hold that thought", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "all set here", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "works for me", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "carry on", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "that's enough", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "no action needed", category: "negation", featureTags: ["negation-preposed", "fallback-zero-score"] },
		{ prompt: "not now", category: "negation", featureTags: ["negation-preposed", "fallback-zero-score"] },
		{
			prompt: "don't do anything yet",
			category: "negation",
			featureTags: ["negation-preposed", "fallback-zero-score"],
		},
		{ prompt: "never mind for now", category: "negation", featureTags: ["negation-preposed", "fallback-zero-score"] },
		{ prompt: "nope, pause", category: "negation", featureTags: ["negation-preposed", "fallback-zero-score"] },
		{ prompt: "not a request", category: "negation", featureTags: ["negation-preposed", "fallback-zero-score"] },
		{ prompt: "not not okay", category: "negation", featureTags: ["double-negation", "fallback-zero-score"] },
		{ prompt: "I don't disagree", category: "negation", featureTags: ["double-negation", "fallback-zero-score"] },
		{ prompt: "네 좋아요", category: "multilingual", featureTags: ["multilingual-ko", "fallback-zero-score"] },
		{ prompt: "응 진행해", category: "multilingual", featureTags: ["multilingual-ko", "fallback-zero-score"] },
		{ prompt: "아니 잠깐", category: "multilingual", featureTags: ["multilingual-ko", "fallback-zero-score"] },
		{ prompt: "괜찮습니다", category: "multilingual", featureTags: ["multilingual-ko", "fallback-zero-score"] },
		{ prompt: "확인했습니다", category: "multilingual", featureTags: ["multilingual-ko", "fallback-zero-score"] },
		{ prompt: "잠시만요", category: "multilingual", featureTags: ["multilingual-ko", "fallback-zero-score"] },
		{ prompt: "sure, later", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "looks okay", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "fine by me", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "one sec", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "roger that", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "same here", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "continue when ready", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "pause please", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
	],
	"simple-edit": [
		{
			prompt: "Change the modal title from Draft to Ready.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Swap the two words in the banner headline.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "verb-synonym"],
		},
		{
			prompt: "Correct the spelling of seperated in the help text.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Trim the extra whitespace around the badge label.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "verb-synonym"],
		},
		{
			prompt: "Adjust one comma in the empty-state sentence.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Update the footer copyright year to 2026.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Reword the tooltip so it says Save draft.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "verb-synonym"],
		},
		{
			prompt: "Fix the capitalization of the settings title only.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Do not rewrite the page; just change the title casing.",
			category: "negation",
			featureTags: ["negation-preposed", "low-edit-risk"],
		},
		{
			prompt: "Skip the refactor and correct the punctuation mark.",
			category: "negation",
			featureTags: ["negation-preposed", "low-edit-risk", "precedence-trap"],
		},
		{
			prompt: "No redesign needed, only remove the stray period.",
			category: "negation",
			featureTags: ["negation-preposed", "low-edit-risk"],
		},
		{
			prompt: "Don't touch behavior; add the missing comma.",
			category: "negation",
			featureTags: ["negation-preposed", "low-edit-risk"],
		},
		{
			prompt: "Change the label first, then we can review the wording.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "low-edit-risk"],
		},
		{
			prompt: "Correct the date format; then note if the docs mention it.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "low-edit-risk"],
		},
		{
			prompt: "Swap the placeholder text and then leave the component alone.",
			category: "compound",
			featureTags: ["compound-leading-intent", "low-edit-risk"],
		},
		{
			prompt: "Add the closing list tag, then sanity-check the snippet later.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "low-edit-risk", "review-vs-codegen"],
		},
		{
			prompt: "README 문구 한 줄만 바꿔줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal", "low-edit-risk"],
		},
		{
			prompt: "제목 대소문자만 고쳐줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal", "low-edit-risk"],
		},
		{
			prompt: "오타 하나 수정해줘, 구조는 그대로 둬.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal", "low-edit-risk"],
		},
		{
			prompt: "띄어쓰기만 정리해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal", "low-edit-risk"],
		},
		{
			prompt: "문장 끝에 마침표만 넣어줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "low-edit-risk"],
		},
		{
			prompt: "리팩터링하지 말고 버튼 문구만 바꿔줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "low-edit-risk", "precedence-trap"],
		},
		{
			prompt: "Review can wait; update the copy line now.",
			category: "precedence",
			featureTags: ["precedence-trap", "review-vs-codegen", "low-edit-risk"],
		},
		{
			prompt: "This is not a bug; fix the grammar in the note.",
			category: "precedence",
			featureTags: ["negation-preposed", "debug-vs-review", "low-edit-risk"],
		},
		{
			prompt: "Only adjust the indentation in the sample block.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Lowercase the small footer title.",
			category: "morphology",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Clean the double space in that sentence.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Bump just the displayed year in the legal footer.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Tweak the placeholder phrase, nothing else.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "verb-synonym"],
		},
		{
			prompt: "Remove the trailing blank in the table caption.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
	],
	"code-gen": [
		{
			prompt: "Whip together a tiny slugifying utility for headings.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Spin up a middleware that attaches a request id.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Cook a helper that batches promise work by size.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Put together a component for an avatar stack.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Draft a migration that stores a display alias column.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "Compose a service that hydrates cached profile cards.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Wire a retry wrapper around the client call.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Craft a rate limiter for bursty form submissions.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Skip the design doc; build the upload handler.",
			category: "negation",
			featureTags: ["negation-preposed", "plan-vs-codegen"],
		},
		{
			prompt: "No review pass now, implement the webhook adapter.",
			category: "negation",
			featureTags: ["negation-preposed", "review-vs-codegen"],
		},
		{
			prompt: "Don't refactor the package; add the validation layer.",
			category: "negation",
			featureTags: ["negation-preposed", "refactor-vs-debug"],
		},
		{
			prompt: "Rather than plan, scaffold the metrics endpoint.",
			category: "negation",
			featureTags: ["negation-preposed", "plan-vs-codegen", "precedence-trap"],
		},
		{
			prompt: "Add a token bucket limiter and then review the threshold names.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "review-vs-codegen"],
		},
		{
			prompt: "Build the csv normalizer, then write a short migration note.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent"],
		},
		{
			prompt: "Create the notification worker; afterward plan the rollout separately.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "plan-vs-codegen"],
		},
		{
			prompt: "Implement the cache key helper and then inspect the edge cases.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "review-vs-codegen"],
		},
		{
			prompt: "검색 입력 컴포넌트 하나 만들어줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "결제 알림 웹훅 처리기 작성해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "재시도 헬퍼 추가해줘, 리뷰는 나중에.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal", "review-vs-codegen"],
		},
		{
			prompt: "테스트 데이터 생성 함수 만들어줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "설계하지 말고 간단한 미들웨어만 만들어줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "plan-vs-codegen"],
		},
		{
			prompt: "검토는 하지 말고 엔드포인트를 추가해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "review-vs-codegen"],
		},
		{
			prompt: "```ts\nexport const sample = makeWidget();\n```",
			category: "fallback-shape",
			featureTags: ["code-shape-signal"],
		},
		{
			prompt: "diff --git a/widget.ts b/widget.ts\n@@ -1 +1,2 @@\n const a = 1\n+const b = 2",
			category: "fallback-shape",
			featureTags: ["diff-shape-signal"],
		},
		{
			prompt: "Need a tiny parser object for bracketed tags.",
			category: "fallback-shape",
			featureTags: ["fallback-zero-score", "noun-synonym"],
		},
		{
			prompt: "A small batch-renamer would be useful here.",
			category: "fallback-shape",
			featureTags: ["fallback-zero-score", "noun-synonym"],
		},
		{
			prompt: "Prototype a guard that rejects empty payloads.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Generate a fixture builder for invoice rows.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Add a mapper from raw events to summary records.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "Scaffold a scheduled cleanup job for stale drafts.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
	],
	debug: [
		{
			prompt: "The ingest job stalls after the second batch; find the cause.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Uploads intermittently return 500 during spikes; get to the bottom of it.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Track down why memory keeps climbing in the queue worker.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "The renderer hangs when the filter is empty; chase the failure.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Requests time out after retries on the staging-like sandbox.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "A flaky assertion trips only under parallel execution.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "The import path throws a ReferenceError in the browser bundle.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "The cache serves stale rows after an update; isolate why.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Not asking for a review; reproduce the crash first.",
			category: "negation",
			featureTags: ["negation-preposed", "debug-vs-review"],
		},
		{
			prompt: "Don't refactor yet, diagnose the deadlock in the lock wrapper.",
			category: "negation",
			featureTags: ["negation-preposed", "refactor-vs-debug"],
		},
		{
			prompt: "No redesign, just trace why the worker fails.",
			category: "negation",
			featureTags: ["negation-preposed", "plan-vs-codegen"],
		},
		{
			prompt: "Skip cleanup; debug the rollback error.",
			category: "negation",
			featureTags: ["negation-preposed", "refactor-vs-debug"],
		},
		{
			prompt: "Debug the crash and then refactor the affected module later.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "refactor-vs-debug"],
		},
		{
			prompt: "Reproduce the timeout, then write a failing test for it.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent"],
		},
		{
			prompt: "Investigate why the queue corrupts data; afterward review safeguards.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "debug-vs-review"],
		},
		{
			prompt: "Trace the panic first, then plan the mitigation separately.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "plan-vs-codegen"],
		},
		{
			prompt: "로그인 요청이 500으로 실패해, 원인 찾아줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "작업 큐가 멈추는 이유를 디버깅해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "크래시 재현부터 해줘, 리팩토링은 나중에.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal", "refactor-vs-debug"],
		},
		{
			prompt: "테스트 실패 원인 분석해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "리팩터링하지 말고 타임아웃만 고쳐줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "refactor-vs-debug"],
		},
		{
			prompt: "검토하지 말고 예외가 나는 이유부터 찾아줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "debug-vs-review"],
		},
		{
			prompt: "Review later: this stack trace points at a null read.",
			category: "precedence",
			featureTags: ["precedence-trap", "debug-vs-review"],
		},
		{
			prompt: "The proposed refactor triggers a segfault; debug that symptom.",
			category: "precedence",
			featureTags: ["precedence-trap", "refactor-vs-debug"],
		},
		{
			prompt: "A release checklist is blocked because the publish step fails.",
			category: "precedence",
			featureTags: ["precedence-trap", "release-runbook"],
		},
		{
			prompt: "A diff review found a panic; now isolate the panic.",
			category: "precedence",
			featureTags: ["precedence-trap", "debug-vs-review", "diff-shape-signal"],
		},
		{
			prompt: "Figure out why the csv reader drops the last row.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Pin down the race that loses websocket messages.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "The nightly task silently fails after rotation.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "A circular dependency error appears only in production mode.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
	],
	refactor: [
		{
			prompt: "Untangle the payment module into cohesive slices.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Tidy up the controller so dependencies point inward.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Consolidate two nearly identical formatters.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Restructure the renderer without altering behavior.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Split the module that handles parsing and persistence.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Move logic out of the giant constructor.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Merge duplicate serializers into one shared path.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Simplify the nested permission branch.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Not a bug hunt; reorganize the data access layer.",
			category: "negation",
			featureTags: ["negation-preposed", "refactor-vs-debug"],
		},
		{
			prompt: "Don't add features, just deduplicate the adapters.",
			category: "negation",
			featureTags: ["negation-preposed", "refactor-vs-debug"],
		},
		{
			prompt: "No review pass needed; extract the policy checks.",
			category: "negation",
			featureTags: ["negation-preposed", "review-vs-codegen"],
		},
		{
			prompt: "Skip debugging for now; clean up the importer shape.",
			category: "negation",
			featureTags: ["negation-preposed", "refactor-vs-debug"],
		},
		{
			prompt: "Refactor the parser and then investigate the old failure.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "refactor-vs-debug"],
		},
		{
			prompt: "Extract the cache seam, then review the naming.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "review-vs-codegen"],
		},
		{
			prompt: "Consolidate the validators; afterward write a tiny adapter.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent"],
		},
		{
			prompt: "Untangle the service first, then plan the next split.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "plan-vs-codegen"],
		},
		{
			prompt: "이 모듈 구조를 리팩토링해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "중복 헬퍼를 하나로 정리해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "동작은 그대로 두고 폴더 구조 리팩토링해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko"],
		},
		{ prompt: "큰 클래스 리팩토링해서 책임별로 나눠줘.", category: "multilingual", featureTags: ["multilingual-ko"] },
		{
			prompt: "버그 수정 말고 구조 개선부터 해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "refactor-vs-debug"],
		},
		{
			prompt: "리뷰하지 말고 리팩터링만 해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "review-vs-codegen"],
		},
		{
			prompt: "The crash fix is done; now refactor the error branch.",
			category: "precedence",
			featureTags: ["precedence-trap", "refactor-vs-debug"],
		},
		{
			prompt: "Review comments aside, rename the ambiguous variables.",
			category: "precedence",
			featureTags: ["precedence-trap", "review-vs-codegen"],
		},
		{
			prompt: "Plan later; modularize the notification bundle now.",
			category: "precedence",
			featureTags: ["precedence-trap", "plan-vs-codegen"],
		},
		{
			prompt: "Debug history aside, simplify the retry state machine.",
			category: "precedence",
			featureTags: ["precedence-trap", "refactor-vs-debug"],
		},
		{
			prompt: "Rename the storage facade and update callers.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Clean up the old feature flags no longer read.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Deduplicate the mock builders shared by tests.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Reorganize exports around domain boundaries.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
	],
	review: [
		{
			prompt: "Give the billing patch a once-over before merge.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Sanity-check the auth flow for gaps.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Eyeball the diff and flag anything risky.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "diff-shape-signal"],
		},
		{
			prompt: "Assess whether the schema change breaks clients.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "Inspect the cache policy for stale-read hazards.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{ prompt: "Critique the error wording for user clarity.", category: "paraphrase", featureTags: ["noun-synonym"] },
		{
			prompt: "Audit the permission checks for privilege leaks.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "Double-check the tests cover the new edge case.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Don't implement anything; evaluate this approach.",
			category: "negation",
			featureTags: ["negation-preposed", "review-vs-codegen"],
		},
		{
			prompt: "No refactor yet, tell me if the structure is safe.",
			category: "negation",
			featureTags: ["negation-preposed", "refactor-vs-debug"],
		},
		{
			prompt: "Skip planning and critique the proposed rollout.",
			category: "negation",
			featureTags: ["negation-preposed", "plan-vs-codegen"],
		},
		{
			prompt: "Not debugging the crash, just review the fix for risk.",
			category: "negation",
			featureTags: ["negation-preposed", "debug-vs-review"],
		},
		{
			prompt: "Review the endpoint and then implement any follow-up later.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "review-vs-codegen"],
		},
		{
			prompt: "Audit the release checklist; afterward plan the rollout.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "release-runbook"],
		},
		{
			prompt: "Inspect the parser diff, then refactor if needed next week.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "refactor-vs-debug"],
		},
		{
			prompt: "Critique the migration notes; then write fixes separately.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "review-vs-codegen"],
		},
		{
			prompt: "이 PR 위험한 부분 검토해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "인증 흐름 보안 점검해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "diff 검토해서 회귀 가능성 확인해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal", "diff-shape-signal"],
		},
		{
			prompt: "버그 수정하지 말고 수정안 리뷰만 해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "debug-vs-review"],
		},
		{
			prompt: "구현하지 말고 설계 위험만 검토해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "review-vs-codegen"],
		},
		{
			prompt: "리팩토링은 나중에 하고 구조만 점검해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "refactor-vs-debug"],
		},
		{
			prompt: "The implementation compiles; review it for regressions.",
			category: "precedence",
			featureTags: ["precedence-trap", "review-vs-codegen"],
		},
		{
			prompt: "The crash is fixed; inspect the patch for side effects.",
			category: "precedence",
			featureTags: ["precedence-trap", "debug-vs-review"],
		},
		{
			prompt: "The roadmap mentions this change; assess the risk only.",
			category: "precedence",
			featureTags: ["precedence-trap", "plan-vs-codegen"],
		},
		{
			prompt: "The refactor branch is ready; give it a code review.",
			category: "precedence",
			featureTags: ["precedence-trap", "refactor-vs-debug"],
		},
		{
			prompt: "Review the open contract for breaking behavior.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "Audit the dependency list for supply-chain exposure.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "Approve only if the accessibility concerns are handled.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Tell me whether this state transition is correct.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
	],
	plan: [
		{
			prompt: "Map out the phases for moving search to a new backend.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Draw up a roadmap for offline-first sync.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Think through the architecture for tenant-scoped billing.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Sketch the delivery strategy for the analytics revamp.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Design a rollout plan for regional failover.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Architect the data pipeline for event replay.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "Prepare a technical spec for an audit trail service.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "Decompose the monolith replacement into quarterly milestones.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Don't code it; plan the integration path.",
			category: "negation",
			featureTags: ["negation-preposed", "plan-vs-codegen"],
		},
		{
			prompt: "No bug report here, design the recovery strategy.",
			category: "negation",
			featureTags: ["negation-preposed", "debug-vs-review"],
		},
		{
			prompt: "Skip the review and plan the migration roadmap.",
			category: "negation",
			featureTags: ["negation-preposed", "review-vs-codegen"],
		},
		{
			prompt: "Rather than implement, architect the storage topology.",
			category: "negation",
			featureTags: ["negation-preposed", "plan-vs-codegen", "precedence-trap"],
		},
		{
			prompt: "Plan the release sequence, then implement the first slice later.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "plan-vs-codegen"],
		},
		{
			prompt: "Design the queue architecture; afterward review tradeoffs.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "debug-vs-review"],
		},
		{
			prompt: "Create a roadmap for observability, then scaffold dashboards separately.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "plan-vs-codegen"],
		},
		{
			prompt: "Map out migration waves and then refactor one module later.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "refactor-vs-debug"],
		},
		{
			prompt: "다음 분기 마이그레이션 계획 세워줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "결제 시스템 아키텍처 설계해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "출시 로드맵을 단계별로 잡아줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "구현하지 말고 데이터 모델 전략 계획을 세워줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "plan-vs-codegen"],
		},
		{
			prompt: "버그 분석 말고 장애 대응 설계를 해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "debug-vs-review"],
		},
		{
			prompt: "리뷰는 나중에 하고 전체 계획부터 세워줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "review-vs-codegen"],
		},
		{
			prompt: "Commit, push, tag, changelog, CI checks, and publish need a governed release plan.",
			category: "precedence",
			featureTags: ["release-runbook", "precedence-trap"],
		},
		{
			prompt: "Implementing the endpoint is premature; design the API lifecycle first.",
			category: "precedence",
			featureTags: ["precedence-trap", "plan-vs-codegen"],
		},
		{
			prompt: "A refactor may follow, but architect the boundary map now.",
			category: "precedence",
			featureTags: ["precedence-trap", "refactor-vs-debug"],
		},
		{
			prompt: "A review will happen later; plan the security hardening program.",
			category: "precedence",
			featureTags: ["precedence-trap", "review-vs-codegen"],
		},
		{
			prompt:
				"Plan a cross-region notification platform with tenant isolation, replayable events, rollout gates, observability objectives, dependency boundaries, rollback criteria, and a phased delivery path that starts with a narrow beta before widening to all accounts.",
			category: "fallback-shape",
			featureTags: ["long-brief-shape", "noun-synonym"],
		},
		{
			prompt:
				"Design the permission model, data ownership boundaries, migration waves, and go or no-go checkpoints for splitting the admin surface into smaller services while preserving audit history.",
			category: "fallback-shape",
			featureTags: ["long-brief-shape", "noun-synonym"],
		},
		{
			prompt:
				"Write a technical spec for a usage-metering subsystem with idempotent ingestion, hourly aggregation, replay, tenant-level throttling, dashboards, and release sequencing.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt:
				"Architect the feature flag governance process, including approval roles, experiment rollout stages, kill switches, and documentation responsibilities.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
	],
} satisfies Readonly<Record<GeneralizationTaskClass, readonly GeneralizationSeed[]>>;

const GENERALIZATION_EXPANSION_CASES_BY_CLASS = {
	trivial: [
		{ prompt: "sounds good, leave it there", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "not this minute", category: "negation", featureTags: ["negation-preposed", "fallback-zero-score"] },
		{ prompt: "copy that", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "okay, parking it", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "later is fine", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "그대로 둬", category: "multilingual", featureTags: ["multilingual-ko", "fallback-zero-score"] },
		{ prompt: "아직 하지 마", category: "multilingual", featureTags: ["multilingual-ko", "fallback-zero-score"] },
		{ prompt: "확인만", category: "multilingual", featureTags: ["multilingual-ko", "fallback-zero-score"] },
		{ prompt: "알겠어", category: "multilingual", featureTags: ["multilingual-ko", "fallback-zero-score"] },
		{ prompt: "좋아 그대로", category: "multilingual", featureTags: ["multilingual-ko", "fallback-zero-score"] },
		{ prompt: "no further work", category: "negation", featureTags: ["negation-preposed", "fallback-zero-score"] },
		{ prompt: "that's all I needed", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "stand by", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "we're done for now", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "not not fine", category: "negation", featureTags: ["double-negation", "fallback-zero-score"] },
	],
	"simple-edit": [
		{
			prompt: "Rename the sidebar tab from Queue to Jobs.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Replace the helper comment's misspelled word enviroment with environment.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Keep logic unchanged; shorten the toast sentence.",
			category: "negation",
			featureTags: ["negation-preposed", "low-edit-risk"],
		},
		{
			prompt: "Not a debugging task: change the chip text to Archived.",
			category: "precedence",
			featureTags: ["negation-preposed", "debug-vs-review", "low-edit-risk", "precedence-trap"],
		},
		{
			prompt: "Review later; remove the duplicate comma now.",
			category: "precedence",
			featureTags: ["precedence-trap", "review-vs-codegen", "low-edit-risk"],
		},
		{
			prompt: "버그 아냐, 문구만 고쳐줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal", "debug-vs-review", "low-edit-risk"],
		},
		{
			prompt: "검토 말고 헤더 문구 한 단어만 바꿔줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "review-vs-codegen", "low-edit-risk"],
		},
		{
			prompt: "Change the aria label wording, no component rewrite.",
			category: "negation",
			featureTags: ["negation-preposed", "low-edit-risk", "review-vs-codegen"],
		},
		{
			prompt: "Set the docs badge text to Stable only.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Delete the extra colon in the summary line.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "verb-synonym"],
		},
		{
			prompt: "Lower the heading one level from H2 to H3.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Replace gray with slate in the theme label.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "noun-synonym"],
		},
		{
			prompt: "Move the period inside the closing quote.",
			category: "paraphrase",
			featureTags: ["low-edit-risk", "verb-synonym"],
		},
		{
			prompt: "Don't plan a rewrite; update the placeholder word.",
			category: "negation",
			featureTags: ["negation-preposed", "plan-vs-codegen", "low-edit-risk", "precedence-trap"],
		},
		{
			prompt: "Patch the typo, not the crash report.",
			category: "precedence",
			featureTags: ["debug-vs-review", "low-edit-risk", "precedence-trap"],
		},
	],
	"code-gen": [
		{
			prompt: "Assemble a small date-range normalizer.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Create an adapter that emits audit events.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Build the health-check route, review can happen later.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "review-vs-codegen"],
		},
		{
			prompt: "Not a plan: add the pagination helper.",
			category: "precedence",
			featureTags: ["negation-preposed", "plan-vs-codegen", "precedence-trap"],
		},
		{
			prompt: "검토 말고 캐시 무효화 함수 작성해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "review-vs-codegen", "short-ko-task-signal"],
		},
		{
			prompt: "디버깅 말고 샘플 데이터 팩토리 만들어줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "debug-vs-review", "short-ko-task-signal"],
		},
		{
			prompt: "Implement a cursor paginator, then inspect naming later.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "review-vs-codegen"],
		},
		{
			prompt: "Generate an in-memory fake for the repository contract.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Add a CLI subcommand that prints queued jobs.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "Write the guard that rejects duplicate slugs.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Need code for a compact breadcrumb component.",
			category: "fallback-shape",
			featureTags: ["fallback-zero-score", "noun-synonym"],
		},
		{
			prompt: "Scaffold a config loader that reads JSON.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Rather than review, wire the retry middleware.",
			category: "negation",
			featureTags: ["negation-preposed", "review-vs-codegen", "precedence-trap"],
		},
		{
			prompt: "Create the mapper first; plan rollout afterward.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "plan-vs-codegen"],
		},
		{
			prompt: "```ts\nconst view = renderSummary(input)\n```",
			category: "fallback-shape",
			featureTags: ["code-shape-signal"],
		},
	],
	debug: [
		{
			prompt: "The worker idles forever after the ack message; determine why.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "After login succeeds, the session vanishes on refresh; trace the break.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "A timer fires twice and duplicates invoices; reproduce the fault.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Not reviewing the patch; identify why the assertion flips.",
			category: "precedence",
			featureTags: ["negation-preposed", "debug-vs-review", "precedence-trap"],
		},
		{
			prompt: "Refactor later; first isolate the stuck promise.",
			category: "precedence",
			featureTags: ["precedence-trap", "refactor-vs-debug", "compound-leading-intent"],
		},
		{
			prompt: "검토 말고 실패 원인부터 추적해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "debug-vs-review", "short-ko-task-signal"],
		},
		{
			prompt: "구조 변경하지 말고 결제 오류 원인을 디버깅해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "refactor-vs-debug", "short-ko-task-signal"],
		},
		{
			prompt: "The diff looks clean, but the button still throws; debug the throw.",
			category: "precedence",
			featureTags: ["precedence-trap", "debug-vs-review", "diff-shape-signal"],
		},
		{
			prompt: "The release job aborts during artifact upload; investigate the abort.",
			category: "precedence",
			featureTags: ["release-runbook", "verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Pinpoint why the websocket closes immediately.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Find the root cause of the disappearing draft.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "The scheduler skips Mondays only; chase that regression.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "No code generation yet, reproduce the blank response.",
			category: "negation",
			featureTags: ["negation-preposed", "review-vs-codegen", "precedence-trap"],
		},
		{
			prompt: "The cache invalidation fix regressed deletes; diagnose the regression.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Review can wait; the smoke check is red and needs a root cause.",
			category: "precedence",
			featureTags: ["precedence-trap", "debug-vs-review", "noun-synonym"],
		},
	],
	refactor: [
		{
			prompt: "Reshape the notification code into a smaller core and adapters.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Behavior should stay fixed; pull parsing out of the route handler.",
			category: "negation",
			featureTags: ["negation-preposed", "refactor-vs-debug", "noun-synonym"],
		},
		{
			prompt: "Don't debug the timeout; reorganize the batching logic.",
			category: "negation",
			featureTags: ["negation-preposed", "refactor-vs-debug", "precedence-trap"],
		},
		{
			prompt: "리뷰 말고 중복 분기 리팩토링만 해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "review-vs-codegen"],
		},
		{
			prompt: "버그 추적 말고 서비스 경계를 다시 나눠줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "refactor-vs-debug"],
		},
		{
			prompt: "Extract a storage port from the report generator.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Restructure the nested feature flag checks into flatter branches.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Rename the ambiguous helper group and update imports.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Fold the duplicate retry paths into a single helper.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Separate validation from persistence in the import flow.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Review is finished; now simplify the adapter layout.",
			category: "precedence",
			featureTags: ["precedence-trap", "review-vs-codegen", "verb-synonym"],
		},
		{
			prompt: "Plan can wait; slice the giant reducer by action family.",
			category: "precedence",
			featureTags: ["precedence-trap", "plan-vs-codegen", "verb-synonym"],
		},
		{
			prompt: "Make the test fixtures share one builder without changing assertions.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Move side-effect wiring out of the domain object.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Untwist the callback chain into readable steps.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
	],
	review: [
		{
			prompt: "Read the permissions patch and call out unsafe assumptions.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Evaluate the new queue design for failure modes, don't build it.",
			category: "negation",
			featureTags: ["negation-preposed", "review-vs-codegen", "plan-vs-codegen"],
		},
		{
			prompt: "Not asking you to fix the crash; judge the patch quality.",
			category: "precedence",
			featureTags: ["negation-preposed", "debug-vs-review", "precedence-trap"],
		},
		{
			prompt: "Implementation is done; assess whether the tests prove the behavior.",
			category: "precedence",
			featureTags: ["precedence-trap", "review-vs-codegen", "noun-synonym"],
		},
		{
			prompt: "검토만 해줘, 코드는 작성하지 마.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "review-vs-codegen", "short-ko-task-signal"],
		},
		{
			prompt: "버그 고치지 말고 패치 위험만 봐줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "debug-vs-review", "short-ko-task-signal"],
		},
		{
			prompt: "Review the migration diff for rollback hazards.",
			category: "paraphrase",
			featureTags: ["diff-shape-signal", "noun-synonym"],
		},
		{
			prompt: "Audit the auth changes before they land.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Check whether this retry strategy can loop forever.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Please critique the API surface, not implement endpoints.",
			category: "negation",
			featureTags: ["negation-preposed", "review-vs-codegen", "precedence-trap"],
		},
		{
			prompt: "The refactor is proposed; review the boundary choices.",
			category: "precedence",
			featureTags: ["precedence-trap", "refactor-vs-debug", "noun-synonym"],
		},
		{
			prompt: "Scan the release notes for misleading claims.",
			category: "precedence",
			featureTags: ["release-runbook", "verb-synonym"],
		},
		{
			prompt: "Approve only if the dependency update risk is acceptable.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Look over the state machine transition table for gaps.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Evaluate the security implications of the new cookie flag.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
	],
	plan: [
		{
			prompt: "Define a phased path for replacing the search index.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Design the incident response workflow for billing outages.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Don't implement; produce the dependency rollout strategy.",
			category: "negation",
			featureTags: ["negation-preposed", "plan-vs-codegen", "precedence-trap"],
		},
		{
			prompt: "Review later, plan the database split first.",
			category: "precedence",
			featureTags: ["precedence-trap", "review-vs-codegen", "compound-leading-intent"],
		},
		{
			prompt: "버그 수정 말고 장애 대응 계획 세워줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "debug-vs-review", "short-ko-task-signal"],
		},
		{
			prompt: "구현하지 말고 권한 모델 설계안을 잡아줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "plan-vs-codegen", "short-ko-task-signal"],
		},
		{
			prompt: "Map the milestones for retiring the legacy queue.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Prepare an architecture strategy for regional data residency.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
		{
			prompt: "Outline the migration waves, rollback triggers, and owner handoffs.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Figure out the product-to-engineering plan for usage limits.",
			category: "mixed",
			featureTags: ["plan-vs-codegen", "debug-vs-review", "noun-synonym"],
		},
		{
			prompt: "Build nothing yet; decompose the file-storage redesign.",
			category: "negation",
			featureTags: ["negation-preposed", "plan-vs-codegen", "precedence-trap"],
		},
		{
			prompt: "Plan the signing-key rotation sequence with safety checkpoints.",
			category: "paraphrase",
			featureTags: ["release-runbook", "noun-synonym"],
		},
		{
			prompt: "Refactor can follow; first define the boundary strategy.",
			category: "precedence",
			featureTags: ["precedence-trap", "refactor-vs-debug", "compound-leading-intent"],
		},
		{
			prompt: "Assemble a release runbook for staged mobile rollout.",
			category: "precedence",
			featureTags: ["release-runbook", "verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Draft the technical approach for tenant-level audit exports.",
			category: "paraphrase",
			featureTags: ["noun-synonym"],
		},
	],
} satisfies Readonly<Record<GeneralizationTaskClass, readonly GeneralizationSeed[]>>;

const GENERALIZATION_WAVE1_SLICE_CASES_BY_CLASS = {
	trivial: [
		{ prompt: "message received", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "noted", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "fine, leave that", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "leave it", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "pause here", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "no next step", category: "negation", featureTags: ["negation-preposed", "fallback-zero-score"] },
		{ prompt: "that answers it", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "ok, stop there", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "sounds settled", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "all good, no task", category: "negation", featureTags: ["negation-preposed", "fallback-zero-score"] },
		{ prompt: "hold off", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "nothing else", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "we're done", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "cool, thanks", category: "fallback-shape", featureTags: ["fallback-zero-score"] },
		{ prompt: "no changes", category: "negation", featureTags: ["negation-preposed", "fallback-zero-score"] },
	],
	"simple-edit": [
		{
			prompt: "Correct the stray semicolon in the snippet.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "low-edit-risk"],
		},
		{
			prompt: "Update the dialog title to say Saved items.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "low-edit-risk"],
		},
		{
			prompt: "Swap the placeholder copy to Search notes.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "low-edit-risk"],
		},
		{
			prompt: "Remove the duplicate period from the tooltip.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "low-edit-risk"],
		},
		{
			prompt: "Adjust the table alignment in the sample.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "low-edit-risk"],
		},
		{
			prompt: "제목 문구만 바꿔줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal", "low-edit-risk"],
		},
		{
			prompt: "Reword one sentence in the empty-state text.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "low-edit-risk"],
		},
		{
			prompt: "Trim the extra whitespace in the heading.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "low-edit-risk"],
		},
		{
			prompt: "Bump the displayed year in the footer.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "low-edit-risk"],
		},
		{
			prompt: "Fix the misspelled word in the button label.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "low-edit-risk"],
		},
		{
			prompt: "Don't refactor, just change the headline capitalization.",
			category: "negation",
			featureTags: ["negation-preposed", "refactor-vs-debug", "low-edit-risk"],
		},
		{
			prompt: "No feature work; update the tooltip punctuation.",
			category: "negation",
			featureTags: ["negation-preposed", "low-edit-risk"],
		},
		{
			prompt: "Change the closing tag in the sample markup.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "low-edit-risk"],
		},
		{
			prompt: "Correct the comma placement in the release note.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "low-edit-risk", "release-runbook"],
		},
		{
			prompt: "Tweak the one-liner description only.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "low-edit-risk"],
		},
	],
	"code-gen": [
		{
			prompt: "Implement a compact slug normalizer with tests.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Build a small CSV preview component.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Create an in-memory queue fake for tests.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Write a parser for bracketed metric labels.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Generate a typed fixture factory for audit events.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Scaffold a CLI command that lists stale drafts.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "간단한 배치 유틸리티를 만들어줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "Add a webhook retry middleware.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Prototype a color-token exporter.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Whip up a helper that groups notifications by day.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Cook me a tiny matcher for route aliases.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Implement input validation for the invite form.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Build the migration that adds an archived flag.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Create a service for rendering weekly summaries.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Write the unit test harness for the formatter.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
	],
	debug: [
		{
			prompt: "Investigate why the receipt preview freezes after export completes.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Trace the NaN total that appears after coupon recomputation.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Reproduce the disappearing cursor in the note editor before touching structure.",
			category: "precedence",
			featureTags: ["precedence-trap", "refactor-vs-debug", "verb-synonym"],
		},
		{
			prompt: "Not a code review; find why the webhook replay stops after one event.",
			category: "negation",
			featureTags: ["negation-preposed", "debug-vs-review", "review-vs-codegen"],
		},
		{
			prompt: "Skip cleanup; isolate the retry storm in the mail queue.",
			category: "negation",
			featureTags: ["negation-preposed", "refactor-vs-debug"],
		},
		{
			prompt: "리뷰는 미루고 합계가 틀리는 원인부터 파악해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "debug-vs-review", "short-ko-task-signal"],
		},
		{
			prompt: "구조 개선하지 말고 알림이 두 번 오는 버그를 재현해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "refactor-vs-debug", "short-ko-task-signal"],
		},
		{
			prompt: "The refactor branch landed, but previews open blank; diagnose the blank screen.",
			category: "precedence",
			featureTags: ["precedence-trap", "refactor-vs-debug"],
		},
		{
			prompt: "The approval checklist is green while export writes zero-byte files; chase the mismatch.",
			category: "precedence",
			featureTags: ["precedence-trap", "release-runbook", "noun-synonym"],
		},
		{
			prompt: "Pinpoint why the carousel sends duplicate analytics pings.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Figure out why saved filters revert after refresh.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "The linter says success but generated output is headers only.",
			category: "precedence",
			featureTags: ["precedence-trap", "code-shape-signal"],
		},
		{
			prompt: "Don't write new endpoints; debug the missing webhook payload.",
			category: "negation",
			featureTags: ["negation-preposed", "review-vs-codegen", "debug-vs-review"],
		},
		{
			prompt: "Review can wait; the fallback answer is empty and needs a cause.",
			category: "precedence",
			featureTags: ["precedence-trap", "debug-vs-review"],
		},
		{
			prompt: "The plan says migrate later; first investigate the stale search results.",
			category: "precedence",
			featureTags: ["precedence-trap", "plan-vs-codegen", "noun-synonym"],
		},
	],
	refactor: [
		{
			prompt: "Modularize the notification renderer without changing behavior.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Extract queue coordination into a narrower gateway.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Don't debug the resend bug; restructure the shipment state branches.",
			category: "negation",
			featureTags: ["negation-preposed", "refactor-vs-debug", "precedence-trap"],
		},
		{
			prompt: "디버깅 말고 승인 로직 구조 개선부터 해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "refactor-vs-debug"],
		},
		{
			prompt: "리뷰하지 말고 오래된 어댑터를 리팩토링해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "review-vs-codegen"],
		},
		{
			prompt: "Review notes are resolved; now consolidate the duplicate guard clauses.",
			category: "precedence",
			featureTags: ["precedence-trap", "review-vs-codegen", "verb-synonym"],
		},
		{
			prompt: "Plan later; untangle the export pipeline into named stages.",
			category: "precedence",
			featureTags: ["precedence-trap", "plan-vs-codegen", "verb-synonym"],
		},
		{
			prompt: "Rename the vague cache helper and update the import sites.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Split the module that formats notifications by responsibility.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Clean up the stale feature toggles without adding behavior.",
			category: "negation",
			featureTags: ["negation-preposed", "verb-synonym"],
		},
		{
			prompt: "Reorganize the dashboard adapters around stable ports.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Simplify the recursive menu builder while keeping snapshots stable.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Deduplicate the stub factories shared across parser tests.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Move logic out of the subscription presenter.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Untangle the observer callbacks before investigating old flakes.",
			category: "compound",
			featureTags: ["compound-leading-intent", "compound-secondary-intent", "refactor-vs-debug"],
		},
	],
	review: [
		{
			prompt: "Pressure-test the consent-flow patch for hidden coupling.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Look over the tokenizer change and flag unsafe assumptions.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Don't build the dashboard; assess whether this UX state is coherent.",
			category: "negation",
			featureTags: ["negation-preposed", "review-vs-codegen", "plan-vs-codegen"],
		},
		{
			prompt: "Not asking for a fix; judge the deadlock patch for residual risk.",
			category: "negation",
			featureTags: ["negation-preposed", "debug-vs-review", "precedence-trap"],
		},
		{
			prompt: "구현하지 말고 세션 처리 방식이 안전한지 점검해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "review-vs-codegen"],
		},
		{
			prompt: "오류 고치지 말고 롤백 위험만 검토해줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "negation-postposed-ko", "debug-vs-review"],
		},
		{
			prompt: "The refactor proposal is ready; review its boundary seams.",
			category: "precedence",
			featureTags: ["precedence-trap", "refactor-vs-debug", "noun-synonym"],
		},
		{
			prompt: "Implementation shipped locally; tell me whether the retry tests prove anything.",
			category: "precedence",
			featureTags: ["precedence-trap", "review-vs-codegen", "noun-synonym"],
		},
		{
			prompt: "Audit the release checklist wording for overpromising.",
			category: "precedence",
			featureTags: ["release-runbook", "verb-synonym"],
		},
		{
			prompt: "Check whether the permission matrix covers delegated admins.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Give the rendering diff a thumbs-up/down for regression risk.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "diff-shape-signal"],
		},
		{
			prompt: "Find flaws in the cache invalidation argument, not code.",
			category: "negation",
			featureTags: ["negation-preposed", "review-vs-codegen"],
		},
		{
			prompt: "Approve only if the migration fallback is safe.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "What could go wrong with this background sync approach?",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Read the concurrency note and challenge the assumptions.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
	],
	plan: [
		{
			prompt: "Plan the phased retirement of the legacy billing queue.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Design an architecture for cross-region draft sync.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Map out milestones for moving reports to async exports.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Draw up a strategy for tenant-aware search indexing.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Think through the rollout risks for encrypted backups.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym"],
		},
		{
			prompt: "Write a technical spec for plugin isolation.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "plan-vs-codegen"],
		},
		{
			prompt: "Create a roadmap for replacing the notification broker.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "plan-vs-codegen"],
		},
		{
			prompt: "실시간 협업 기능 도입 계획을 세워줘.",
			category: "multilingual",
			featureTags: ["multilingual-ko", "short-ko-task-signal"],
		},
		{
			prompt: "Don't implement; decompose the permissions overhaul.",
			category: "negation",
			featureTags: ["negation-preposed", "review-vs-codegen", "plan-vs-codegen"],
		},
		{
			prompt: "No coding yet, architect the workspace migration.",
			category: "negation",
			featureTags: ["negation-preposed", "plan-vs-codegen"],
		},
		{
			prompt: "Implementation later; plan the data-retention rollout first.",
			category: "precedence",
			featureTags: ["precedence-trap", "plan-vs-codegen"],
		},
		{
			prompt: "Define the release phases before any review.",
			category: "precedence",
			featureTags: ["precedence-trap", "release-runbook", "debug-vs-review"],
		},
		{
			prompt: "Design the go/no-go checklist for staged publishing.",
			category: "paraphrase",
			featureTags: ["release-runbook", "noun-synonym"],
		},
		{
			prompt: "Plan a quarter-by-quarter migration from polling to events.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "long-brief-shape"],
		},
		{
			prompt: "Architect the backup recovery workflow with failure modes.",
			category: "paraphrase",
			featureTags: ["verb-synonym", "noun-synonym", "long-brief-shape"],
		},
	],
} satisfies Readonly<Record<GeneralizationTaskClass, readonly GeneralizationSeed[]>>;

function formatGeneralizationId(index: number): string {
	return `gen-v4-${String(index).padStart(4, "0")}`;
}

function contentBlindHash(value: string): number {
	let hash = 2166136261;
	for (const char of value) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash;
}

/**
 * Content-blind split assignment. Uses only stable opaque id + class + a frozen
 * salt; prompt text and feature tags never affect train/dev/holdout membership.
 */
export function computeGeneralizationSplit(
	entry: Pick<GeneralizationEntry, "id" | "expectedClass">,
): GeneralizationSplit {
	const bucket = contentBlindHash(`${entry.expectedClass}:${entry.id}:generalization-split-v40`) % 9;
	if (bucket < 2) {
		return "holdout";
	}
	if (bucket < 4) {
		return "dev";
	}
	return "train";
}

function pushGeneralizationEntry(
	entries: GeneralizationEntry[],
	expectedClass: GeneralizationTaskClass,
	seed: GeneralizationSeed,
): void {
	const candidate = {
		id: formatGeneralizationId(entries.length + 1),
		expectedClass,
	};
	entries.push({
		...candidate,
		prompt: seed.prompt,
		expectedLevel: GENERALIZATION_CLASS_LEVELS[expectedClass],
		split: computeGeneralizationSplit(candidate),
		category: seed.category,
		featureTags: seed.featureTags,
		labelVersion: GENERALIZATION_SET_VERSION,
	});
}

function buildGeneralizationSet(): readonly GeneralizationEntry[] {
	const entries: GeneralizationEntry[] = [];
	for (const expectedClass of GENERALIZATION_TASK_CLASSES) {
		for (const seed of GENERALIZATION_BASE_CASES_BY_CLASS[expectedClass]) {
			pushGeneralizationEntry(entries, expectedClass, seed);
		}
	}
	for (const expectedClass of GENERALIZATION_TASK_CLASSES) {
		for (const seed of GENERALIZATION_EXPANSION_CASES_BY_CLASS[expectedClass]) {
			pushGeneralizationEntry(entries, expectedClass, seed);
		}
	}
	for (const expectedClass of GENERALIZATION_TASK_CLASSES) {
		for (const seed of GENERALIZATION_WAVE1_SLICE_CASES_BY_CLASS[expectedClass]) {
			pushGeneralizationEntry(entries, expectedClass, seed);
		}
	}
	return entries;
}

export const REASONING_ROUTER_GENERALIZATION_SET: readonly GeneralizationEntry[] = buildGeneralizationSet();

export interface GeneralizationSplitCounts {
	readonly train: number;
	readonly dev: number;
	readonly holdout: number;
}

export interface GeneralizationSetSummary {
	readonly total: number;
	readonly perClass: Readonly<Record<GeneralizationTaskClass, number>>;
	readonly perSplit: GeneralizationSplitCounts;
	readonly perClassSplit: Readonly<Record<GeneralizationTaskClass, GeneralizationSplitCounts>>;
	readonly perFeatureTag: Readonly<Record<GeneralizationFeatureTag, number>>;
}

function zeroClassCounts(): Record<GeneralizationTaskClass, number> {
	return { trivial: 0, "simple-edit": 0, "code-gen": 0, debug: 0, refactor: 0, review: 0, plan: 0 };
}

function zeroSplitCounts(): { train: number; dev: number; holdout: number } {
	return { train: 0, dev: 0, holdout: 0 };
}

function zeroFeatureTagCounts(): Record<GeneralizationFeatureTag, number> {
	return {
		"verb-synonym": 0,
		"noun-synonym": 0,
		"negation-preposed": 0,
		"negation-postposed-ko": 0,
		"double-negation": 0,
		"compound-leading-intent": 0,
		"compound-secondary-intent": 0,
		"precedence-trap": 0,
		"multilingual-ko": 0,
		"short-ko-task-signal": 0,
		"long-brief-shape": 0,
		"fallback-zero-score": 0,
		"code-shape-signal": 0,
		"diff-shape-signal": 0,
		"release-runbook": 0,
		"low-edit-risk": 0,
		"review-vs-codegen": 0,
		"debug-vs-review": 0,
		"plan-vs-codegen": 0,
		"refactor-vs-debug": 0,
	};
}

export function summarizeGeneralizationSet(
	entries: readonly GeneralizationEntry[] = REASONING_ROUTER_GENERALIZATION_SET,
): GeneralizationSetSummary {
	const perClass = zeroClassCounts();
	const perSplit = zeroSplitCounts();
	const perClassSplit: Record<GeneralizationTaskClass, { train: number; dev: number; holdout: number }> = {
		trivial: zeroSplitCounts(),
		"simple-edit": zeroSplitCounts(),
		"code-gen": zeroSplitCounts(),
		debug: zeroSplitCounts(),
		refactor: zeroSplitCounts(),
		review: zeroSplitCounts(),
		plan: zeroSplitCounts(),
	};
	const perFeatureTag = zeroFeatureTagCounts();
	for (const entry of entries) {
		perClass[entry.expectedClass] += 1;
		perSplit[entry.split] += 1;
		perClassSplit[entry.expectedClass][entry.split] += 1;
		for (const featureTag of entry.featureTags) {
			perFeatureTag[featureTag] += 1;
		}
	}
	return { total: entries.length, perClass, perSplit, perClassSplit, perFeatureTag };
}

export function summarizeGeneralizationSplit(
	entries: readonly GeneralizationEntry[] = REASONING_ROUTER_GENERALIZATION_SET,
): Pick<GeneralizationSetSummary, "total" | "perSplit" | "perClassSplit"> {
	const summary = summarizeGeneralizationSet(entries);
	return { total: summary.total, perSplit: summary.perSplit, perClassSplit: summary.perClassSplit };
}

export function computeGeneralizationFingerprint(entries: readonly GeneralizationEntry[]): string {
	let hash = 2166136261;
	for (const entry of entries) {
		const serialized = `${entry.id}\u0000${entry.prompt}\u0000${entry.expectedClass}\u0000${entry.expectedLevel}\u0000${entry.category}\u0000${entry.featureTags.join(",")}\n`;
		for (const char of serialized) {
			hash ^= char.codePointAt(0) ?? 0;
			hash = Math.imul(hash, 16777619) >>> 0;
		}
	}
	return hash.toString(16).padStart(8, "0");
}

export function computeGeneralizationPriorFingerprint(
	entries: readonly GeneralizationEntry[] = REASONING_ROUTER_GENERALIZATION_SET.slice(
		0,
		GENERALIZATION_PRIOR_TOTAL_ROWS,
	),
): string {
	return computeGeneralizationFingerprint(entries);
}
