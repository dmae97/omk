import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("bundles the planner without Node capabilities and runs in an isolated JS context", async () => {
	const result = await build({
		entryPoints: [fileURLToPath(new URL("../src/commit-planner.ts", import.meta.url))],
		bundle: true,
		platform: "browser",
		format: "iife",
		globalName: "AtomicPlanner",
		write: false,
	});
	const code = result.outputFiles[0]?.text;
	if (!code) throw new Error("Missing browser bundle");
	const observed: unknown = runInNewContext(
		`${code}\nAtomicPlanner.planAtomicCommits({policyVersion:'v1',repoId:'r',worktreeId:'w',sessionId:'s',baseCommit:'base',atoms:[],relations:[]}).validationOrder.length`,
		{},
		{ timeout: 2000 },
	);
	expect(observed).toBe(0);
});
