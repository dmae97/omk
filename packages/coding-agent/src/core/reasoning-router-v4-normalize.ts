import type { TaskClassV4 } from "./reasoning-router-v4-weights.ts";

type EvidenceResultV4 = {
	readonly clusterMatch: Readonly<Record<TaskClassV4, boolean>>;
	readonly skeletonMatch: Readonly<Record<TaskClassV4, boolean>>;
	readonly deferredClasses: readonly TaskClassV4[];
	readonly featureIds: readonly string[];
};
const wordsV4 = (text: string): readonly string[] => text.split(" ");
const koRowV4 = (canonical: string, surfaces: string): readonly [string, readonly string[]] => [
	canonical,
	wordsV4(surfaces),
];
const IRREGULAR_ENGLISH_STEMS: Readonly<Record<string, string>> = {
	aborted: "abort",
	aborts: "abort",
	broke: "break",
	broken: "break",
	breaks: "break",
	built: "build",
	causes: "cause",
	fired: "fire",
	found: "find",
	hung: "hang",
	hangs: "hang",
	skipped: "skip",
	skips: "skip",
	stuck: "stick",
	thrown: "throw",
	vanished: "vanish",
	vanishes: "vanish",
	wrote: "write",
	written: "write",
} as const;
const KOREAN_SUFFIXES = wordsV4(
	"해주세요 해줘요 해줘 줘요 거예요 거야 는데 어요 아요 해요 하게 하고 하지 하면 해서 하는 하다 으로 에서 에게 까지 부터 처럼 보다 줘 요 은 는 이 가 을 를 도 만 에 로 와 과",
);
const KOREAN_CANONICAL = [
	koRowV4("고치", "고쳐 고칠 고치 수정"),
	koRowV4("찾", "찾아 찾을 찾"),
	koRowV4("나누", "나눠 나눌 나누"),
	koRowV4("멈추", "멈췄 멈춰 멈추 먹통"),
	koRowV4("깨지", "깨졌 깨져 깨짐 깨지"),
	koRowV4("단순", "단순"),
	koRowV4("안맞", "안맞 맞아 맞지"),
	koRowV4("검토", "검토"),
	koRowV4("리뷰", "리뷰"),
	koRowV4("점검", "점검"),
	koRowV4("위험", "위험"),
	koRowV4("안전", "안전"),
	koRowV4("허점", "허점"),
	koRowV4("오해", "오해"),
	koRowV4("중복", "중복"),
	koRowV4("경계", "경계"),
	koRowV4("분리", "분리"),
	koRowV4("정리", "정리"),
	koRowV4("구조", "구조"),
	koRowV4("헬퍼", "헬퍼"),
	koRowV4("서비스", "서비스"),
	koRowV4("검증", "검증"),
	koRowV4("저장", "저장"),
	koRowV4("콜백", "콜백"),
	koRowV4("체인", "체인"),
	koRowV4("원인", "원인"),
	koRowV4("실패", "실패"),
	koRowV4("오류", "오류 에러"),
	koRowV4("추적", "추적"),
	koRowV4("재현", "재현"),
	koRowV4("버그", "버그"),
	koRowV4("리팩터링", "리팩터링 리팩토링"),
] as const;
const DEBUG_ACTIONS = wordsV4(
	"debug investigate reproduce trace find isolate chase determine root cause why trigger regression 찾 원인 재현",
);
const DEBUG_SYMPTOMS = wordsV4(
	"stall hang break fail red vanish abort stick wrong mismatch stale disappear fire crash 멈추 깨지 실패 오류 안맞",
);
const REVIEW_ACTIONS = wordsV4("review audit evaluate scan judge assess check tell call read look flag 검토 리뷰 점검");
const REVIEW_OBJECTS = wordsV4(
	"safe risky risk unsafe mislead claim implication assumption gap flaw hole security coupling edge policy 위험 안전 허점 오해",
);
const REFACTOR_ACTIONS = wordsV4(
	"fold separate untwist untangle slice pull move extract reshape split deduplicate consolidate simplify clean restructure organize 나누 분리 정리 단순 리팩터링",
);
const REFACTOR_OBJECTS = wordsV4(
	"duplicate repeated retry branch path validation persistence callback promise chain reducer boundary layer handler helper service structure adapter wrapper 중복 헬퍼 경계 구조 검증 저장 콜백 체인 서비스",
);
function normalizeEnglishTokenV4(token: string): string {
	const irregular = IRREGULAR_ENGLISH_STEMS[token];
	if (irregular !== undefined) return irregular;
	if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
	if (token.length > 5 && token.endsWith("ing")) return trimDoubledConsonantV4(token.slice(0, -3));
	if (token.length > 4 && token.endsWith("ed")) return trimDoubledConsonantV4(token.slice(0, -2));
	if (token.length > 4 && token.endsWith("es")) return token.endsWith("ses") ? token.slice(0, -1) : token.slice(0, -2);
	if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
	return token;
}
function trimDoubledConsonantV4(stem: string): string {
	const last = stem.at(-1);
	const previous = stem.at(-2);
	return last !== undefined && last === previous && !"aeiou".includes(last) ? stem.slice(0, -1) : stem;
}

function stripKoreanSuffixV4(token: string): string {
	for (const suffix of KOREAN_SUFFIXES) {
		if (token.length > suffix.length + 1 && token.endsWith(suffix)) return token.slice(0, -suffix.length);
	}
	return token;
}

function normalizeKoreanTokenV4(token: string): string {
	const stripped = stripKoreanSuffixV4(token);
	for (const [canonical, surfaces] of KOREAN_CANONICAL) {
		if (surfaces.some((surface) => stripped.includes(surface))) return canonical;
	}
	return stripped;
}

export function normalizeIntentTokensV4(text: string): readonly string[] {
	const seen = new Set<string>();
	for (const match of text
		.normalize("NFKC")
		.toLowerCase()
		.matchAll(/[a-z]+|[가-힣]+/g)) {
		const token = match[0];
		seen.add(/[a-z]/.test(token) ? normalizeEnglishTokenV4(token) : normalizeKoreanTokenV4(token));
	}
	return [...seen];
}

function hasAnyV4(tokens: ReadonlySet<string>, anchors: readonly string[]): boolean {
	return anchors.some((anchor) => tokens.has(anchor));
}

function hasSkipSymptomV4(tokens: ReadonlySet<string>): boolean {
	return tokens.has("skip") && !tokens.has("review");
}

function createClassMapV4(): Record<TaskClassV4, boolean> {
	return {
		debug: false,
		refactor: false,
		review: false,
		plan: false,
		"simple-edit": false,
		"code-gen": false,
		trivial: false,
	};
}

function classMentionsV4(tokens: ReadonlySet<string>): readonly TaskClassV4[] {
	const classes: TaskClassV4[] = [];
	if (hasAnyV4(tokens, REVIEW_ACTIONS)) classes.push("review");
	if (hasAnyV4(tokens, REFACTOR_ACTIONS) || tokens.has("refactor")) classes.push("refactor");
	if (
		hasAnyV4(tokens, DEBUG_ACTIONS) ||
		hasAnyV4(tokens, DEBUG_SYMPTOMS) ||
		hasSkipSymptomV4(tokens) ||
		tokens.has("bug")
	)
		classes.push("debug");
	if (tokens.has("plan") || tokens.has("계획")) classes.push("plan");
	return classes;
}

function skeletonClassV4(tokens: ReadonlySet<string>): TaskClassV4 | null {
	const debug =
		(hasAnyV4(tokens, DEBUG_SYMPTOMS) || hasSkipSymptomV4(tokens)) &&
		(hasAnyV4(tokens, DEBUG_ACTIONS) || tokens.has("root"));
	if (debug || (tokens.has("root") && tokens.has("cause"))) return "debug";
	if (hasAnyV4(tokens, REVIEW_ACTIONS) && hasAnyV4(tokens, REVIEW_OBJECTS)) return "review";
	if (
		(tokens.has("mislead") || tokens.has("오해")) &&
		(tokens.has("claim") || tokens.has("policy") || tokens.has("문구"))
	)
		return "review";
	if (hasAnyV4(tokens, REFACTOR_ACTIONS) && hasAnyV4(tokens, REFACTOR_OBJECTS)) return "refactor";
	return null;
}

function splitDeferredCurrentV4(text: string): { readonly deferred: string; readonly current: string } | null {
	const head = text.slice(0, 200);
	const malgoIndex = head.indexOf("말고");
	if (malgoIndex >= 0) {
		const current = head.slice(malgoIndex + "말고".length).trim();
		if (current.length >= 3) return { deferred: head.slice(0, malgoIndex + "말고".length), current };
	}
	const koreanLater = /나중에\s*하고/i.exec(head);
	if (koreanLater !== null) {
		const current = head.slice(koreanLater.index + koreanLater[0].length).trim();
		if (current.length >= 3) return { deferred: head.slice(0, koreanLater.index + koreanLater[0].length), current };
	}
	const split =
		/^(.{1,100}\b(?:can\s+wait|can\s+follow|later|history\s+aside|after\s+lunch|no\s+\w+\s+yet|not\s+asking\s+for\s+a\s+\w+|don't\s+\w+\s+yet)\b[^;,.!?—-]*)(?:[;,.!?—-]+|\s+)\s*(.{3,})/i.exec(
			head,
		);
	return split === null ? null : { deferred: split[1] ?? "", current: split[2] ?? "" };
}

function normalizedSetV4(text: string): ReadonlySet<string> {
	return new Set(normalizeIntentTokensV4(text));
}

export function extractGeneralizedIntentEvidenceV4(text: string): EvidenceResultV4 {
	const tokens = normalizedSetV4(text);
	const clusterMatch = createClassMapV4();
	const skeletonMatch = createClassMapV4();
	const featureIds: string[] = [];
	const debugCluster =
		hasAnyV4(tokens, DEBUG_SYMPTOMS) ||
		hasSkipSymptomV4(tokens) ||
		(hasAnyV4(tokens, DEBUG_ACTIONS) &&
			(tokens.has("cause") || tokens.has("regression") || tokens.has("trigger") || tokens.has("why")));
	const reviewCluster = hasAnyV4(tokens, REVIEW_ACTIONS) && hasAnyV4(tokens, REVIEW_OBJECTS);
	const reviewObjectCluster =
		(tokens.has("mislead") && (tokens.has("claim") || tokens.has("policy"))) ||
		(tokens.has("오해") && tokens.has("문구"));
	const refactorCluster = hasAnyV4(tokens, REFACTOR_ACTIONS) && hasAnyV4(tokens, REFACTOR_OBJECTS);
	if (debugCluster) clusterMatch.debug = true;
	if (reviewCluster || reviewObjectCluster || hasAnyV4(tokens, ["검토", "리뷰", "점검", "허점"]))
		clusterMatch.review = true;
	if (
		refactorCluster ||
		(hasAnyV4(tokens, ["중복", "경계", "콜백", "체인"]) && hasAnyV4(tokens, ["정리", "나누", "분리", "단순"]))
	)
		clusterMatch.refactor = true;
	const deferred = splitDeferredCurrentV4(text);
	const skeletonTarget =
		deferred === null ? text : deferred.current.replace(/^(?:first|now|just|currently|먼저|지금은|지금)\s+/i, "");
	const skeletonClass = skeletonClassV4(normalizedSetV4(skeletonTarget));
	const malgoDeferred = text.indexOf("말고");
	const deferredText =
		deferred !== null ? deferred.deferred : malgoDeferred >= 0 ? text.slice(0, malgoDeferred + "말고".length) : null;
	const deferredClasses = deferredText === null ? [] : classMentionsV4(normalizedSetV4(deferredText));
	const inferredDeferredClasses: readonly TaskClassV4[] =
		deferredClasses.length > 0
			? deferredClasses
			: tokens.has("말고") && (tokens.has("버그") || tokens.has("추적") || tokens.has("고치"))
				? ["debug"]
				: [];
	for (const taskClass of ["debug", "review", "refactor"] as const) {
		if (clusterMatch[taskClass]) featureIds.push(`normalized:${taskClass}`);
	}
	if (skeletonClass !== null) {
		skeletonMatch[skeletonClass] = true;
		featureIds.push(`skeleton:${skeletonClass}`);
	}
	for (const taskClass of inferredDeferredClasses) featureIds.push(`deferral:${taskClass}`);
	return { clusterMatch, skeletonMatch, deferredClasses: inferredDeferredClasses, featureIds };
}
