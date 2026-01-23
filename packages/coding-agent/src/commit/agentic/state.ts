import type { CommitType, ConventionalAnalysis, ConventionalDetail, NumstatEntry } from "$c/commit/types";

export interface GitOverviewSnapshot {
	files: string[];
	stat: string;
	numstat: NumstatEntry[];
	scopeCandidates: string;
	isWideScope: boolean;
	untrackedFiles?: string[];
}

export interface CommitProposal {
	analysis: ConventionalAnalysis;
	summary: string;
	warnings: string[];
}

export interface SplitCommitGroup {
	files: string[];
	type: CommitType;
	scope: string | null;
	summary: string;
	details: ConventionalDetail[];
	issueRefs: string[];
	rationale?: string;
}

export interface SplitCommitPlan {
	commits: SplitCommitGroup[];
	warnings: string[];
}

export interface CommitAgentState {
	overview?: GitOverviewSnapshot;
	proposal?: CommitProposal;
	splitProposal?: SplitCommitPlan;
}
