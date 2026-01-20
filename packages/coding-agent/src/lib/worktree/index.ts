export { type CollapseOptions, type CollapseResult, type CollapseStrategy, collapse } from "./collapse";
export { WORKTREE_BASE } from "./constants";
export { WorktreeError, WorktreeErrorCode } from "./errors";
export { getRepoName, getRepoRoot, git, gitWithInput as gitWithStdin } from "./git";
export { create, find, list, prune, remove, type Worktree, which } from "./operations";
export {
	cleanupSessions,
	createSession,
	getSession,
	listSessions,
	type SessionStatus,
	updateSession,
	type WorktreeSession,
} from "./session";
export { formatStats, getStats, type WorktreeStats } from "./stats";
