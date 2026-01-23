import { Type } from "@sinclair/typebox";
import type { CommitAgentState, SplitCommitGroup, SplitCommitPlan } from "$c/commit/agentic/state";
import {
	capDetails,
	MAX_DETAIL_ITEMS,
	normalizeSummary,
	SUMMARY_MAX_CHARS,
	validateSummaryRules,
	validateTypeConsistency,
} from "$c/commit/agentic/validation";
import { validateScope } from "$c/commit/analysis/validation";
import type { ControlledGit } from "$c/commit/git";
import type { ConventionalDetail } from "$c/commit/types";
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

const splitCommitSchema = Type.Object({
	commits: Type.Array(
		Type.Object({
			files: Type.Array(Type.String(), { minItems: 1 }),
			type: commitTypeSchema,
			scope: Type.Union([Type.String(), Type.Null()]),
			summary: Type.String(),
			details: Type.Optional(Type.Array(detailSchema)),
			issue_refs: Type.Optional(Type.Array(Type.String())),
			rationale: Type.Optional(Type.String()),
		}),
		{ minItems: 2 },
	),
});

interface SplitCommitResponse {
	valid: boolean;
	errors: string[];
	warnings: string[];
	proposal?: SplitCommitPlan;
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

export function createSplitCommitTool(
	git: ControlledGit,
	state: CommitAgentState,
): CustomTool<typeof splitCommitSchema> {
	return {
		name: "split_commit",
		label: "Split Commit",
		description: "Propose multiple atomic commits for unrelated changes.",
		parameters: splitCommitSchema,
		async execute(_toolCallId, params) {
			const stagedFiles = state.overview?.files ?? (await git.getStagedFiles());
			const stagedSet = new Set(stagedFiles);
			const usedFiles = new Set<string>();
			const errors: string[] = [];
			const warnings: string[] = [];
			const diffText = await git.getDiff(true);

			const commits: SplitCommitGroup[] = params.commits.map((commit, index) => {
				const scope = commit.scope?.trim() || null;
				const summary = normalizeSummary(commit.summary, commit.type, scope);
				const detailInput = normalizeDetails(commit.details ?? []);
				const detailResult = capDetails(detailInput);
				warnings.push(...detailResult.warnings.map((warning) => `Commit ${index + 1}: ${warning}`));
				const issueRefs = commit.issue_refs ?? [];

				const summaryValidation = validateSummaryRules(summary);
				const scopeValidation = validateScope(scope);
				const typeValidation = validateTypeConsistency(commit.type, commit.files, {
					diffText,
					summary,
					details: detailResult.details,
				});

				if (summaryValidation.errors.length > 0) {
					errors.push(...summaryValidation.errors.map((error) => `Commit ${index + 1}: ${error}`));
				}
				if (!scopeValidation.valid) {
					errors.push(...scopeValidation.errors.map((error) => `Commit ${index + 1}: ${error}`));
				}
				if (typeValidation.errors.length > 0) {
					errors.push(...typeValidation.errors.map((error) => `Commit ${index + 1}: ${error}`));
				}
				warnings.push(...summaryValidation.warnings.map((warning) => `Commit ${index + 1}: ${warning}`));
				warnings.push(...typeValidation.warnings.map((warning) => `Commit ${index + 1}: ${warning}`));

				return {
					files: commit.files,
					type: commit.type,
					scope,
					summary,
					details: detailResult.details,
					issueRefs,
					rationale: commit.rationale?.trim() || undefined,
				};
			});

			for (const commit of commits) {
				for (const file of commit.files) {
					if (!stagedSet.has(file)) {
						errors.push(`File not staged: ${file}`);
						continue;
					}
					if (usedFiles.has(file)) {
						errors.push(`File appears in multiple commits: ${file}`);
						continue;
					}
					usedFiles.add(file);
				}
			}

			for (const file of stagedFiles) {
				if (!usedFiles.has(file)) {
					errors.push(`Staged file missing from split plan: ${file}`);
				}
			}

			const response: SplitCommitResponse = {
				valid: errors.length === 0,
				errors,
				warnings,
			};

			if (response.valid) {
				response.proposal = { commits, warnings };
				state.splitProposal = response.proposal;
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
