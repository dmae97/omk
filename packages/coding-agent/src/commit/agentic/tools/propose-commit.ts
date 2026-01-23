import { Type } from "@sinclair/typebox";
import type { CommitAgentState } from "$c/commit/agentic/state";
import {
	capDetails,
	MAX_DETAIL_ITEMS,
	normalizeSummary,
	SUMMARY_MAX_CHARS,
	validateSummaryRules,
	validateTypeConsistency,
} from "$c/commit/agentic/validation";
import { validateAnalysis } from "$c/commit/analysis/validation";
import type { ControlledGit } from "$c/commit/git";
import type { CommitType, ConventionalAnalysis, ConventionalDetail } from "$c/commit/types";
import type { CustomTool } from "$c/extensibility/custom-tools/types";

const commitTypeSchema = Type.Union([
	Type.Literal("feat"),
	Type.Literal("fix"),
	Type.Literal("refactor"),
	Type.Literal("perf"),
	Type.Literal("docs"),
	Type.Literal("test"),
	Type.Literal("build"),
	Type.Literal("ci"),
	Type.Literal("chore"),
	Type.Literal("style"),
	Type.Literal("revert"),
]);

const detailSchema = Type.Object({
	text: Type.String(),
	changelog_category: Type.Optional(
		Type.Union([
			Type.Literal("Added"),
			Type.Literal("Changed"),
			Type.Literal("Fixed"),
			Type.Literal("Deprecated"),
			Type.Literal("Removed"),
			Type.Literal("Security"),
			Type.Literal("Breaking Changes"),
		]),
	),
	user_visible: Type.Optional(Type.Boolean()),
});

const proposeCommitSchema = Type.Object({
	type: commitTypeSchema,
	scope: Type.Union([Type.String(), Type.Null()]),
	summary: Type.String(),
	details: Type.Array(detailSchema),
	issue_refs: Type.Array(Type.String()),
});

interface ProposalResponse {
	valid: boolean;
	errors: string[];
	warnings: string[];
	proposal?: {
		type: CommitType;
		scope: string | null;
		summary: string;
		details: ConventionalDetail[];
		issue_refs: string[];
	};
}

function normalizeDetails(
	details: Array<{
		text: string;
		changelog_category?: ConventionalDetail["changelogCategory"];
		user_visible?: boolean;
	}>,
): ConventionalDetail[] {
	return details.map((detail) => ({
		text: detail.text.trim(),
		changelogCategory: detail.user_visible ? detail.changelog_category : undefined,
		userVisible: detail.user_visible ?? false,
	}));
}

export function createProposeCommitTool(
	git: ControlledGit,
	state: CommitAgentState,
): CustomTool<typeof proposeCommitSchema> {
	return {
		name: "propose_commit",
		label: "Propose Commit",
		description: "Submit the final conventional commit proposal.",
		parameters: proposeCommitSchema,
		async execute(_toolCallId, params) {
			const scope = params.scope?.trim() || null;
			const summary = normalizeSummary(params.summary, params.type, scope);
			const details = normalizeDetails(params.details);
			const { details: cappedDetails, warnings: detailWarnings } = capDetails(details);
			const analysis: ConventionalAnalysis = {
				type: params.type,
				scope,
				details: cappedDetails,
				issueRefs: params.issue_refs ?? [],
			};

			const summaryValidation = validateSummaryRules(summary);
			const analysisValidation = validateAnalysis(analysis);
			const stagedFiles = state.overview?.files ?? (await git.getStagedFiles());
			const diffText = await git.getDiff(true);
			const typeValidation = validateTypeConsistency(params.type, stagedFiles, {
				diffText,
				summary,
				details: cappedDetails,
			});

			const errors = [...summaryValidation.errors, ...analysisValidation.errors, ...typeValidation.errors];
			const warnings = [...summaryValidation.warnings, ...detailWarnings, ...typeValidation.warnings];

			const response: ProposalResponse = {
				valid: errors.length === 0,
				errors,
				warnings,
			};

			if (response.valid) {
				response.proposal = {
					type: analysis.type,
					scope: analysis.scope,
					summary,
					details: analysis.details,
					issue_refs: analysis.issueRefs,
				};
				state.proposal = {
					analysis,
					summary,
					warnings,
				};
			}

			const text = JSON.stringify(
				{
					...response,
					constraints: {
						maxSummaryChars: SUMMARY_MAX_CHARS,
						maxDetailItems: MAX_DETAIL_ITEMS,
					},
				},
				null,
				2,
			);

			return {
				content: [{ type: "text", text }],
				details: response,
			};
		},
	};
}
