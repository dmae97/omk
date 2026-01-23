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

export interface FileObservation {
	file: string;
	summary: string;
	highlights: string[];
	risks: string[];
	additions: number;
	deletions: number;
}

export type HunkSelector =
	| { type: "all" }
	| { type: "indices"; indices: number[] }
	| { type: "lines"; start: number; end: number };

export interface FileChange {
	path: string;
	hunks: HunkSelector;
}

export interface SplitCommitGroup {
	changes: FileChange[];
	type: CommitType;
	scope: string | null;
	summary: string;
	details: ConventionalDetail[];
	issueRefs: string[];
	rationale?: string;
	dependencies: number[];
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
