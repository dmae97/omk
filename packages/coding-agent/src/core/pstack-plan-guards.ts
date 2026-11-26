const MUTATING_TOOLS: ReadonlySet<string> = new Set([
	"edit",
	"write",
	"replace",
	"replace_match",
	"insert",
	"copy",
	"move",
	"undo_last_change",
	"enter_worktree",
	"ctx_patch",
	"lean-ctx__ctx_patch",
	"subagent",
	"stagehand_act",
	"cloudflare__execute",
	"adaptorch__adaptorch_run",
	"adaptorch__adaptorch_cancel_run",
	"memory_add",
	"memory_replace",
	"memory_remove",
	"skill_manage",
	"github__create_or_update_file",
	"github__push_files",
	"github__delete_file",
	"github__create_branch",
	"github__create_pull_request",
	"github__merge_pull_request",
	"github__issue_write",
	"github__add_issue_comment",
	"github__update_issue_comment",
	"github__add_comment_to_pending_review",
	"github__add_reply_to_pull_request_comment",
	"github__pull_request_review_write",
	"github__update_pull_request",
	"github__update_pull_request_branch",
	"github__create_repository",
	"github__fork_repository",
	"github__sub_issue_write",
]);

const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "hypa_shell", "lean-ctx__ctx_shell", "lean-ctx__shell"]);

const SAFE_SIMPLE_BINS: ReadonlySet<string> = new Set([
	"ls",
	"cat",
	"head",
	"tail",
	"wc",
	"pwd",
	"echo",
	"rg",
	"grep",
	"fd",
	"tree",
	"stat",
	"file",
	"which",
	"command",
	"env",
	"printenv",
	"uname",
	"date",
	"du",
	"df",
	"sort",
	"uniq",
	"cut",
	"jq",
]);

const SAFE_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
	"status",
	"log",
	"diff",
	"show",
	"rev-parse",
	"ls-files",
	"blame",
	"grep",
	"describe",
	"for-each-ref",
]);

const SAFE_GIT_PRE_FLAGS: ReadonlySet<string> = new Set(["-P", "--no-pager", "--no-optional-locks"]);

const SAFE_GH_AREAS: ReadonlySet<string> = new Set(["issue", "pr", "repo", "run", "release", "workflow"]);
const SAFE_GH_ACTIONS: ReadonlySet<string> = new Set(["view", "list", "status", "diff", "checks"]);

const SAFE_HERDR_PAIRS: ReadonlySet<string> = new Set([
	"pane:list",
	"pane:read",
	"agent:list",
	"agent:get",
	"agent:read",
	"workspace:list",
	"worktree:list",
	"tab:list",
	"session:list",
]);

const MUTATING_GIT_BRANCH_FLAGS = /\s-(?:[dDmMcC]|delete|move|copy|force)\b/;
const MUTATING_FIND_FLAGS = /\s-(?:delete|exec|execdir|ok|okdir|fprint|fprintf|fls)\b/;
const SHELL_REDIRECT_OR_SUBST = /(?:>>?|<<|\$\(|`|\btee\b|\bsed\s+-i\b|\bperl\s+-i\b)/;

export function isWriteToolName(toolName: string): boolean {
	return MUTATING_TOOLS.has(toolName.toLowerCase());
}

export function isShellToolName(toolName: string): boolean {
	return SHELL_TOOLS.has(toolName.toLowerCase());
}

export function filterReadOnlyTools(tools: readonly string[]): string[] {
	return tools.filter((name) => !isWriteToolName(name));
}

function isSafeSegment(segment: string): boolean {
	const trimmed = segment.trim();
	if (!trimmed) return false;
	const tokens = trimmed.split(/\s+/);
	const bin = tokens[0] ?? "";
	if (SAFE_SIMPLE_BINS.has(bin)) return true;
	if (bin === "find") return !MUTATING_FIND_FLAGS.test(trimmed);
	if (bin === "git") {
		let idx = 1;
		while (idx < tokens.length && tokens[idx]?.startsWith("-")) {
			const flag = tokens[idx]!;
			if (flag === "-C") idx += 2;
			else if (SAFE_GIT_PRE_FLAGS.has(flag)) idx += 1;
			else return false;
		}
		const sub = tokens[idx] ?? "";
		if (SAFE_GIT_SUBCOMMANDS.has(sub)) return true;
		if (sub === "branch") return !MUTATING_GIT_BRANCH_FLAGS.test(trimmed);
		if (sub === "worktree") return tokens[idx + 1] === "list";
		return false;
	}
	if (bin === "gh") {
		return SAFE_GH_AREAS.has(tokens[1] ?? "") && SAFE_GH_ACTIONS.has(tokens[2] ?? "");
	}
	if (bin === "npm") {
		const sub = tokens[1] ?? "";
		return sub === "list" || sub === "ls" || sub === "outdated" || sub === "view";
	}
	if (bin === "node") return tokens[1] === "-v" || tokens[1] === "--version";
	if (bin === "herdr") {
		const sub = tokens[1] ?? "";
		if (sub === "--help" || sub === "--version" || sub === "status") return true;
		return SAFE_HERDR_PAIRS.has(`${sub}:${tokens[2] ?? ""}`);
	}
	return false;
}

export function isReadOnlyPlanCommand(command: string): boolean {
	const trimmed = command.trim();
	if (!trimmed || SHELL_REDIRECT_OR_SUBST.test(trimmed)) return false;
	const segments = trimmed.split(/\s*(?:&&|\|\||;|\|)\s*/);
	return segments.length > 0 && segments.every(isSafeSegment);
}
