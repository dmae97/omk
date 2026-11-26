export type BranchBackend = "herdr" | "git";

export interface GitBranchEntry {
	readonly name: string;
	readonly current: boolean;
	readonly upstream?: string;
	readonly ahead: number;
	readonly behind: number;
}

export interface GitWorktreeEntry {
	readonly path: string;
	readonly head: string;
	readonly branch: string | null;
	readonly bare: boolean;
	readonly prunable: boolean;
}

export interface RepoBranchSnapshot {
	readonly inRepo: boolean;
	readonly repoRoot?: string;
	readonly currentBranch: string | null;
	readonly dirtyCount: number;
	readonly branches: readonly GitBranchEntry[];
	readonly worktrees: readonly GitWorktreeEntry[];
	readonly backend: BranchBackend;
}

export type BranchCommandAction =
	| { readonly kind: "menu" }
	| { readonly kind: "status" }
	| { readonly kind: "list" }
	| { readonly kind: "switch"; readonly name: string }
	| { readonly kind: "create"; readonly name: string; readonly base?: string }
	| { readonly kind: "worktree"; readonly name: string; readonly base?: string; readonly openPane: boolean }
	| { readonly kind: "prune"; readonly apply: boolean }
	| { readonly kind: "help" }
	| { readonly kind: "invalid"; readonly message: string };

const INVALID_BRANCH_CHARS = /[\x00-\x1f\x7f ~^:?*[\]\\]/;

export function validateBranchName(name: string): string | undefined {
	if (!name) return "Branch name cannot be empty.";
	if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/") || name.endsWith(".")) {
		return `Invalid branch name: "${name}".`;
	}
	if (name.includes("..") || name.includes("//") || name.includes("@{") || name.endsWith(".lock")) {
		return `Invalid branch name: "${name}".`;
	}
	if (INVALID_BRANCH_CHARS.test(name)) return `Branch name contains illegal characters: "${name}".`;
	return undefined;
}

export function slugifyWorktreeDir(branchName: string): string {
	const cleaned = branchName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return cleaned || "worktree";
}

export function parseBranchCommandArgs(raw: string): BranchCommandAction {
	const trimmed = raw.trim();
	if (!trimmed) return { kind: "menu" };
	const tokens = trimmed.split(/\s+/);
	const sub = (tokens[0] ?? "").toLowerCase();
	if (sub === "status") return { kind: "status" };
	if (sub === "list" || sub === "ls") return { kind: "list" };
	if (sub === "help" || sub === "-h" || sub === "--help") return { kind: "help" };
	if (sub === "prune") return { kind: "prune", apply: tokens.includes("--apply") };
	if (sub === "switch" || sub === "sw" || sub === "checkout") {
		const name = tokens[1] ?? "";
		const err = validateBranchName(name);
		return err ? { kind: "invalid", message: err } : { kind: "switch", name };
	}
	if (sub === "new" || sub === "create") {
		const name = tokens[1] ?? "";
		const err = validateBranchName(name);
		if (err) return { kind: "invalid", message: err };
		return tokens[2] ? { kind: "create", name, base: tokens[2] } : { kind: "create", name };
	}
	if (sub === "worktree" || sub === "wt") {
		const openPane = tokens.includes("--pane");
		const positional = tokens.slice(1).filter((t) => t !== "--pane");
		const name = positional[0] ?? "";
		const err = validateBranchName(name);
		if (err) return { kind: "invalid", message: err };
		return { kind: "worktree", name, base: positional[1], openPane };
	}
	return { kind: "invalid", message: `Unknown /branch subcommand: "${sub}". Run /branch help.` };
}

export function parseBranchListPorcelain(stdout: string): GitBranchEntry[] {
	const result: GitBranchEntry[] = [];
	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		const [head = "", name = "", upstreamRaw = "", track = ""] = line.split("\t");
		if (!name) continue;
		result.push({
			name,
			current: head.trim() === "*",
			upstream: upstreamRaw.trim() || undefined,
			ahead: Number(track.match(/ahead (\d+)/)?.[1] ?? 0),
			behind: Number(track.match(/behind (\d+)/)?.[1] ?? 0),
		});
	}
	return result;
}

export function parseWorktreePorcelain(stdout: string): GitWorktreeEntry[] {
	const entries: GitWorktreeEntry[] = [];
	let current: { path?: string; head?: string; branch: string | null; bare: boolean; prunable: boolean } | null = null;
	const flush = () => {
		if (current?.path) {
			entries.push({
				path: current.path,
				head: current.head ?? "",
				branch: current.branch,
				bare: current.bare,
				prunable: current.prunable,
			});
		}
		current = null;
	};
	for (const line of stdout.split("\n")) {
		if (!line.trim()) {
			flush();
		} else if (line.startsWith("worktree ")) {
			flush();
			current = { path: line.slice(9).trim(), branch: null, bare: false, prunable: false };
		} else if (current && line.startsWith("HEAD ")) {
			current.head = line.slice(5).trim();
		} else if (current && line.startsWith("branch refs/heads/")) {
			current.branch = line.slice(18).trim();
		} else if (current && line === "bare") {
			current.bare = true;
		} else if (current && line.startsWith("prunable")) {
			current.prunable = true;
		}
	}
	flush();
	return entries;
}

export function parseHerdrPaneId(stdout: string): string | undefined {
	try {
		const parsed = JSON.parse(stdout) as { result?: { pane?: { pane_id?: unknown } }; pane?: { pane_id?: unknown } };
		const id = parsed.result?.pane?.pane_id ?? parsed.pane?.pane_id;
		return typeof id === "string" && id.trim() ? id.trim() : undefined;
	} catch {
		return undefined;
	}
}

export function formatBranchBadge(snap: RepoBranchSnapshot): string | undefined {
	if (!snap.inRepo || !snap.currentBranch) return undefined;
	const parts = [snap.currentBranch];
	if (snap.dirtyCount > 0) parts.push(`*${snap.dirtyCount}`);
	if (snap.worktrees.length > 1) parts.push(`wt:${snap.worktrees.length}`);
	if (snap.backend === "herdr") parts.push("herdr");
	return parts.join(" ");
}

export function formatBranchSnapshotSummary(snap: RepoBranchSnapshot): string {
	if (!snap.inRepo) return "Not inside a git repository.";
	const branchLines = snap.branches.map(
		(b) => `${b.current ? "*" : " "} ${b.name}${b.ahead || b.behind ? ` (+${b.ahead}/-${b.behind})` : ""}`,
	);
	const wtLines = snap.worktrees.map(
		(w) => `  ${w.branch ?? "detached"} -> ${w.path}${w.prunable ? " [prunable]" : ""}`,
	);
	return [
		`Branch: ${snap.currentBranch ?? "detached"} (dirty: ${snap.dirtyCount}, backend: ${snap.backend})`,
		`Branches (${snap.branches.length}):\n${branchLines.join("\n") || "  (none)"}`,
		`Worktrees (${snap.worktrees.length}):\n${wtLines.join("\n") || "  (none)"}`,
	].join("\n");
}
