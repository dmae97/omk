import type { ExtensionContext } from "./extensions/types.ts";
import * as gitBranch from "./git-branch-manager.ts";

export async function runBranchMenu(
	ctx: ExtensionContext,
	snap: gitBranch.RepoBranchSnapshot,
	opts: { readonly runner?: gitBranch.CommandRunner; readonly herdrActive: boolean },
): Promise<boolean> {
	if (!ctx.hasUI || !snap.inRepo) {
		ctx.ui.notify(gitBranch.formatBranchSnapshotSummary(snap), "info");
		return false;
	}
	const wtLabel = opts.herdrActive ? "Create worktree + Herdr pane" : "Create worktree";
	const picked = await ctx.ui.select(`Branch (${snap.currentBranch ?? "detached"})`, [
		"Switch branch",
		"Create new branch",
		wtLabel,
		"Prune stale worktrees (dry-run)",
		"Show branch & worktree summary",
	]);
	if (!picked) return false;
	if (picked === "Show branch & worktree summary") {
		ctx.ui.notify(gitBranch.formatBranchSnapshotSummary(snap), "info");
		return false;
	}
	let res: gitBranch.BranchOpResult;
	if (picked === "Switch branch") {
		const target = await ctx.ui.select(
			"Switch to branch",
			snap.branches.map((b) => b.name),
		);
		if (!target) return false;
		res = await gitBranch.executeBranchAction(ctx.cwd, { kind: "switch", name: target }, { runner: opts.runner });
	} else if (picked === "Create new branch" || picked === wtLabel) {
		const name = (await ctx.ui.input("New branch name", "feat/my-task"))?.trim();
		if (!name) return false;
		const kind = picked === wtLabel ? "worktree" : "create";
		res = await gitBranch.executeBranchAction(ctx.cwd, { kind, name, openPane: opts.herdrActive }, opts);
	} else {
		res = await gitBranch.executeBranchAction(ctx.cwd, { kind: "prune", apply: false }, { runner: opts.runner });
	}
	ctx.ui.notify(res.ok ? res.message : res.error, res.ok ? "info" : "warning");
	return true;
}
