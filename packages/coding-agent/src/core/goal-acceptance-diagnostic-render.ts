/** Spec 094: the framed diagnostic block for one failed acceptance check. */
import {
	buildDiagnosticExcerpt,
	type DiagnosticOutput,
	GOAL_DIAGNOSTIC_TAG,
	GOAL_DIAGNOSTIC_TRUST,
} from "./goal-acceptance-diagnostic.ts";

export interface AcceptanceDiagnosticInput {
	readonly receiptId: string;
	readonly goalId: string;
	readonly goalRevision: number;
	readonly round: number;
	readonly workspaceSha256: string;
	readonly workspaceCompleteness: string;
	readonly status: string;
	readonly exitCode: number | null;
	readonly gateReason: string;
	readonly output: DiagnosticOutput;
}

export interface AcceptanceDiagnostic {
	readonly kind: "validation_diagnostic";
	readonly checkRef: string;
	readonly attemptRef: string;
	readonly workspaceRef: string;
	readonly outcome: string;
	readonly exitCode: number | null;
	readonly gateReason: string;
	readonly excerpt: string;
	readonly truncated: boolean;
	readonly trust: typeof GOAL_DIAGNOSTIC_TRUST;
}

/** Pure: the §7.6 subset for one failed check. */
export function buildAcceptanceDiagnostic(input: AcceptanceDiagnosticInput): AcceptanceDiagnostic {
	const excerpt = buildDiagnosticExcerpt(input.output);
	return {
		kind: "validation_diagnostic",
		checkRef: input.receiptId,
		attemptRef: `${input.goalId}@r${input.goalRevision}#${input.round}`,
		workspaceRef: `${input.workspaceSha256}:${input.workspaceCompleteness}`,
		outcome: input.status,
		exitCode: input.exitCode,
		gateReason: input.gateReason,
		excerpt: excerpt.text,
		truncated: excerpt.truncated,
		trust: GOAL_DIAGNOSTIC_TRUST,
	};
}

/** Neutralize any tag of the fence inside untrusted content. */
export function escapeFence(text: string): string {
	return text.replace(/<(\/?)(acceptance-diagnostic)/gi, "<\\$1$2");
}

function attribute(value: string): string {
	return value.replace(/[^A-Za-z0-9@#:._-]/g, "_");
}

/** The fenced block appended to the repair follow-up. */
export function renderAcceptanceDiagnostic(diagnostic: AcceptanceDiagnostic): string {
	const open =
		`<${GOAL_DIAGNOSTIC_TAG} check="${attribute(diagnostic.checkRef)}" attempt="${attribute(diagnostic.attemptRef)}"` +
		` workspace="${attribute(diagnostic.workspaceRef)}" exit="${diagnostic.exitCode ?? "none"}" truncated="${diagnostic.truncated}"` +
		` trust="${diagnostic.trust}">`;
	return `${open}\n${escapeFence(diagnostic.excerpt)}\n</${GOAL_DIAGNOSTIC_TAG}>`;
}
