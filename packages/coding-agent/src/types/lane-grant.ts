/**
 * Lane grant schema for OMK subagent isolation.
 *
 * Mirrors the lane grant contract defined in `.omk/agent/AGENTS.md`.
 * Used by the lane-grant auditor to detect parallel writer conflicts
 * before merge.
 */

export type AgentRole =
	| "planner"
	| "explorer"
	| "coder"
	| "tester"
	| "reviewer"
	| "security"
	| "memory"
	| "synthesizer"
	| "architect"
	| "devops"
	| "qa";

export type AuthorityLevel =
	| "read-only"
	| "advisory"
	| "write-scoped"
	| "execute-tests"
	| "review-only"
	| "memory-write";

export interface LaneGrant {
	/** Unique lane identifier. */
	laneId: string;
	/** Agent role / type. */
	agent: AgentRole;
	/** Task node this lane executes. */
	taskNodeId: string;
	/** Plain-language allowed scope. */
	scope: string;
	/** Authority level. */
	authority: AuthorityLevel;
	/** Paths the lane may read. */
	allowedPaths: string[];
	/** Paths the lane must never touch. */
	blockedPaths: string[];
	/** Skill names available to the lane. */
	skills: string[];
	/** Hook/extension scripts active for the lane. */
	hooks: string[];
	/** MCP servers available to the lane. */
	mcp: string[];
	/** Measurable pass criteria. */
	acceptance: string[];
	/** Path where the lane writes evidence. */
	evidenceOutput: string;
	/** Explicitly forbidden actions. */
	forbiddenActions: string[];
}

export interface PathConflict {
	/** Lanes whose write scopes overlap. */
	lanes: [string, string];
	/** Overlapping path or directory subtree. */
	overlappingPath: string;
	/** Severity: advisory or merge-blocked. */
	severity: "advisory" | "merge-blocked";
	/** Suggested resolution. */
	suggestion: string;
}

export interface LaneGrantAuditReport {
	/** Lane grants that were audited. */
	grants: LaneGrant[];
	/** Detected conflicts. */
	conflicts: PathConflict[];
	/** Merge-blocked if any conflict has severity merge-blocked. */
	mergeBlocked: boolean;
	/** Evidence artifact path. */
	evidencePath: string;
}
