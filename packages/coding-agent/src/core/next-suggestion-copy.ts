/**
 * Wording of the host-built next-task suggestion, per situation and locale.
 *
 * Every string describes a check to run or a thing to confirm; none claims a result.
 * `{0}` is the situation subject (failed tools or the first changed path).
 */
import type { SuggestionLocale } from "./next-suggestion-facts.ts";

export type SuggestionSituation = "blocked" | "reconnect" | "diagnose" | "verify" | "clarify" | "continue";

export interface SituationCopy {
	readonly title: string;
	readonly problem: string;
	readonly unknown: string;
	readonly check: string;
	readonly userPath: string;
	readonly regression: string;
	readonly collect: string;
	readonly deliverable: string;
	readonly done: string;
}

type CopyRow = readonly [string, string, string, string, string, string, string, string, string];

const KO: Readonly<Record<SuggestionSituation, CopyRow>> = {
	blocked: [
		"차단됨: 사용할 수 있는 모델 없음",
		"선택된 모델이 없거나 인증되지 않아 요청을 실행할 수 없음. 모델 선택 또는 로그인이 먼저 필요함",
		"사용 가능한 provider와 인증 상태",
		"모델을 선택한 뒤 짧은 요청이 응답을 받으면 통과",
		"/model 로 모델을 선택하거나 /login 으로 인증",
		"모델이 없는 상태에서는 이 프롬프트를 전송하지 않음",
		"선택한 provider와 모델, 인증 결과",
		"요청을 보낼 수 있는 세션 상태",
		"모델이 선택되고 요청 전송이 가능함",
	],
	reconnect: [
		"provider 실패 확인과 로컬 점검",
		"직전 턴이 오류로 끝났음. provider 연결 상태를 확인하고 로컬에서 가능한 점검부터 진행",
		"오류가 일시적인지, 인증, 사용량 한도, 네트워크 중 무엇인지",
		"같은 요청을 한 번 재시도해 응답이 오면 통과. 반복 실패하면 인증, 한도, 네트워크 순서로 확인",
		"모델 선택과 로그인 상태를 확인한 뒤 중단된 요청을 다시 전송",
		"재시도를 반복하지 않음. 두 번 연속 실패하면 중단하고 오류 원문을 보고",
		"오류 원문, 선택된 provider와 모델, 재시도 결과",
		"복구된 연결, 또는 차단 원인과 필요한 조치",
		"중단된 요청이 완료되거나 차단 원인이 구체적으로 확인됨",
	],
	diagnose: [
		"실패 재현과 원인 분리: {0}",
		"직전 실행에서 해결되지 않은 도구 실패가 관측됨. 재현하고 원인을 분리",
		"근본 원인과 영향 범위",
		"같은 입력으로 실패를 재현하고 원인 후보를 하나씩 분리. 수정 후 같은 명령이 종료 코드 0이면 통과",
		"실패가 발생한 실제 명령 또는 사용자 경로를 그대로 다시 실행",
		"재현되지 않으면 원인 확정으로 보지 않음. 회귀 테스트가 수정 전 실패, 수정 후 통과해야 함",
		"전체 실패 출력과 로그, 재현 명령, 수정 전후 실행 결과",
		"원인 설명, 최소 수정, 회귀 테스트",
		"재현 명령과 회귀 테스트가 통과하고 기존 통과 테스트가 유지됨",
	],
	verify: [
		"변경 검증: {0}",
		"직전 실행이 파일을 변경했음. 이 변경이 요청을 충족하는지 검증",
		"변경에 대한 테스트, 타입 검사, 린트의 실행 여부와 결과",
		"변경 경로에 해당하는 타깃 테스트, 타입 검사, 린트를 실행. 모두 종료 코드 0이면 통과",
		"변경된 동작을 실제 진입점(CLI, 화면, API)에서 호출해 요청한 결과가 나오는지 확인",
		"변경 전 통과하던 테스트가 실패하면 회귀로 판정",
		"실행한 명령과 종료 상태, 변경 diff, 사용자 경로 확인 결과",
		"검증 결과와 필요한 경우의 수정",
		"타깃 검사와 사용자 경로 확인이 통과하고 미검증 항목이 명시됨",
	],
	clarify: [
		"작업 목표와 대상 범위 확인",
		"이 세션에는 아직 확인된 작업 요청이 없음. 해결할 문제와 대상 파일 또는 모듈을 먼저 정함",
		"목표, 대상 경로, 완료 기준",
		"목표, 대상 범위, 완료 기준이 각각 한 문장으로 확정되면 통과",
		"대상 기능의 진입점(명령, 화면, API)을 코드에서 찾아 실제 호출 경로를 확인",
		"목표가 정해지기 전에 파일을 수정하면 실패",
		"관련 파일 경로, 현재 branch와 dirty 상태, 적용되는 프로젝트 지침",
		"확정된 목표와 범위, 조사한 코드 경로 요약",
		"다음 작업을 바로 시작할 수 있을 만큼 목표, 범위, 완료 기준이 명시됨",
	],
	continue: [
		"직전 답변의 미확인 사항 점검",
		"직전 요청이 파일 변경이나 관측된 실패 없이 끝났음. 답변이 요청을 충족하는지와 남은 작업을 확인",
		"완료 기준 충족 여부와 후속 작업 필요 여부",
		"직전 요청의 요구사항을 항목별로 답변과 대조. 모든 항목에 근거가 있으면 통과",
		"답변이 가리키는 파일, 명령, 동작을 실제로 열거나 실행해 확인",
		"근거가 없는 항목은 완료로 보지 않음. 이미 끝난 작업은 반복하지 않음",
		"요구사항별 근거(파일 경로, 명령 출력)와 남은 작업 목록",
		"충족, 미충족, 미확인으로 구분한 점검 결과와 다음 작업 한 가지",
		"미충족과 미확인 항목마다 다음 행동이 정해짐",
	],
};

const EN: Readonly<Record<SuggestionSituation, CopyRow>> = {
	blocked: [
		"Blocked: no usable model",
		"No model is selected or its provider is not authenticated, so a request cannot run. Select a model or log in first",
		"available providers and authentication state",
		"passes when a short request gets a response after a model is selected",
		"select a model with /model or authenticate with /login",
		"do not send this prompt while no model is selected",
		"selected provider and model, authentication result",
		"a session state that can send requests",
		"a model is selected and a request can be sent",
	],
	reconnect: [
		"Check the provider failure and run local checks",
		"The last turn ended with an error. Check the provider connection and start with checks that run locally",
		"whether the error is transient, or caused by authentication, a usage limit, or the network",
		"retry the same request once; a response passes. On repeat failure check authentication, limits, then network",
		"confirm the model selection and login state, then resend the interrupted request",
		"do not loop on retries. After two consecutive failures stop and report the raw error",
		"raw error text, selected provider and model, retry result",
		"a restored connection, or the blocking cause and the action it needs",
		"the interrupted request completes or the blocking cause is identified",
	],
	diagnose: [
		"Reproduce the failure and isolate the cause: {0}",
		"The last run left an unresolved tool failure. Reproduce it and isolate the cause",
		"root cause and affected scope",
		"reproduce with the same input and toggle one cause candidate at a time. Exit code 0 on the same command after the fix passes",
		"rerun the actual command or user path that failed",
		"no reproduction means no confirmed cause. A regression test must fail before the fix and pass after it",
		"full failure output and logs, the reproduction command, before and after results",
		"cause explanation, minimal fix, regression test",
		"the reproduction command and regression test pass and previously passing tests still pass",
	],
	verify: [
		"Verify the change: {0}",
		"The last run changed files. Verify that the change satisfies the request",
		"whether tests, type checks and lint ran for the change, and their results",
		"run the targeted tests, type check and lint for the changed paths. All exit code 0 passes",
		"call the changed behavior through its real entry point (CLI, screen, API) and confirm the requested result",
		"a test that passed before the change and fails now is a regression",
		"commands run with exit status, the change diff, the user-path result",
		"verification results and any fix they require",
		"targeted checks and the user-path check pass and unverified items are listed",
	],
	clarify: [
		"Confirm the task goal and target scope",
		"This session has no confirmed task request yet. Decide the problem and the target files or module first",
		"goal, target paths, completion criteria",
		"passes when goal, target scope and completion criteria are each fixed in one sentence",
		"find the feature's entry point (command, screen, API) in the code and confirm the real call path",
		"editing a file before the goal is fixed is a failure",
		"relevant file paths, current branch and dirty state, applicable project instructions",
		"the fixed goal and scope, and a summary of the inspected code paths",
		"goal, scope and completion criteria are explicit enough to start the next task",
	],
	continue: [
		"Review what the last answer left unconfirmed",
		"The last request ended without file changes or an observed failure. Check that the answer satisfies it and what remains",
		"whether the completion criteria are met and whether follow-up work is needed",
		"compare each requirement of the last request with the answer. Passes when every item has support",
		"open or run the files, commands and behavior the answer points to",
		"an item without support is not complete. Do not repeat work that is already done",
		"per-requirement support (file paths, command output) and the list of remaining work",
		"a review split into met, unmet and unconfirmed, plus one next task",
		"every unmet or unconfirmed item has a next action",
	],
};

export function situationCopy(
	situation: SuggestionSituation,
	locale: SuggestionLocale,
	subject: string,
): SituationCopy {
	const [title, problem, unknown, check, userPath, regression, collect, deliverable, done] = (
		locale === "ko" ? KO : EN
	)[situation];
	return {
		title: title.replace("{0}", subject),
		problem,
		unknown,
		check,
		userPath,
		regression,
		collect,
		deliverable,
		done,
	};
}
