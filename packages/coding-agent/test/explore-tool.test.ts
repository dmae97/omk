import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runExploreCommand } from "../src/commands/explore.ts";
import { decideExploration, EXPLORATION_THRESHOLDS } from "../src/core/explorer/exploration-policy.ts";
import { createExploreToolDefinition } from "../src/core/tools/explore.ts";

const roots: string[] = [];

function fixture(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "omk-explore-tool-")));
	roots.push(root);
	mkdirSync(join(root, "src"), { recursive: true });
	writeFileSync(
		join(root, "src", "auth.ts"),
		"export function authenticateUser(token: string) {\n\treturn token.length > 0;\n}\n",
	);
	return root;
}

afterEach(() => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("exploration policy thresholds", () => {
	it("keeps narrow reads direct", () => {
		expect(decideExploration({ expectedSearches: 1, expectedFiles: 1 }).mode).toBe("direct");
	});
	it("delegates when 2+ searches are expected", () => {
		const decision = decideExploration({ expectedSearches: EXPLORATION_THRESHOLDS.minSearches });
		expect(decision.mode).toBe("explore");
		expect(decision.reason).toContain("searches");
	});
	it("delegates when 4+ files are expected", () => {
		expect(decideExploration({ expectedFiles: EXPLORATION_THRESHOLDS.minFiles }).mode).toBe("explore");
	});
	it("delegates on high context pressure", () => {
		expect(decideExploration({ contextPressure: EXPLORATION_THRESHOLDS.contextPressure }).mode).toBe("explore");
	});
});

describe("explore tool definition", () => {
	it("returns paths and ranges without writing to the workspace", async () => {
		const cwd = fixture();
		const before = await import("node:fs/promises").then((fs) => fs.readFile(join(cwd, "src", "auth.ts"), "utf8"));
		const tool = createExploreToolDefinition(cwd);
		const outcome = await tool.execute("call-1", { question: "authenticateUser" }, undefined);
		const text = outcome.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
		expect(text).toContain("src/auth.ts");
		expect(text).toContain("matched: authenticateuser");
		const after = await import("node:fs/promises").then((fs) => fs.readFile(join(cwd, "src", "auth.ts"), "utf8"));
		expect(after).toBe(before);
	});
});

describe("omk explore --auto", () => {
	it("stays direct for a narrow question", async () => {
		const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const outcome = await runExploreCommand(["explore", "--auto", "--searches", "1", "authenticateUser"]);
		expect(outcome.exitCode).toBe(0);
		const payload = JSON.parse(write.mock.calls[0][0] as string);
		expect(payload.decision.mode).toBe("direct");
		expect(payload.result).toBeUndefined();
	});

	it("delegates and returns the evidence pack when searches cross the threshold", async () => {
		const cwd = fixture();
		const previous = process.cwd();
		process.chdir(cwd);
		try {
			const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
			const outcome = await runExploreCommand(["explore", "--auto", "--searches", "2", "authenticateUser"]);
			expect(outcome.exitCode).toBe(0);
			const payload = JSON.parse(write.mock.calls[0][0] as string);
			expect(payload.decision.mode).toBe("explore");
			expect(payload.result.files[0].path).toBe("src/auth.ts");
		} finally {
			process.chdir(previous);
		}
	});
});
