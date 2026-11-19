import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { journalPath } from "../src/core/verified-run/journal.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

const binary = process.env.WORKBENCH_TEST_BINARY;
interface MutationInput {
	schemaVersion: string;
	runtime: string;
	capabilities: Record<string, unknown>;
	cursor: Record<string, unknown>;
	state: Record<string, unknown>;
	nodes: unknown[];
	edges: unknown[];
}

it.skipIf(!binary)(
	"passes actual source CLI snapshots through the Rust binary and rejects malformed observations",
	async () => {
		if (!binary) throw new Error("explicit workbench binary required");
		const root = mkdtempSync(join(tmpdir(), "workbench-wire-"));
		try {
			const f = dagFixture(root, true);
			await f.coordinator.start(f.contract, f.command, f.approval);
			const journal = readFileSync(journalPath(f.runPath));
			const cli = spawnSync(
				process.execPath,
				["--import", "tsx", "packages/coding-agent/src/cli.ts", "run", "graph", "dag", "--state-dir", f.stateRoot],
				{
					cwd: fileURLToPath(new URL("../../../", import.meta.url)),
					env: { PATH: process.env.PATH, HOME: root, OMK_OFFLINE: "1", OMK_SKIP_VERSION_CHECK: "1" },
					encoding: "utf8",
					timeout: 30000,
					maxBuffer: 1048576,
				},
			);
			expect(cli.status, cli.stderr).toBe(0);
			const consume = (input: string) =>
				spawnSync(binary, [], { input, env: {}, cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 1048576 });
			const result = consume(cli.stdout);
			expect(result.status, result.stderr).toBe(0);
			expect(result.stderr).toBe("");
			expect(JSON.parse(result.stdout)).toEqual(JSON.parse(cli.stdout));
			const node = JSON.parse(result.stdout).nodes.find((value: { id: string }) => value.id === "right");
			expect(node).toMatchObject({ status: "failed", attempt: 1, generation: 1 });
			const mutate = (change: (value: MutationInput) => void) => {
				const value: MutationInput = JSON.parse(cli.stdout);
				change(value);
				return `${JSON.stringify(value)}\n`;
			};
			const malformed = [
				mutate((value) => {
					value.capabilities.execute = true;
				}),
				mutate((value) => {
					value.runtime = "rust";
				}),
				mutate((value) => {
					value.schemaVersion = "omk.native-agent.v1";
				}),
				mutate((value) => {
					value.state.verification = "passed";
				}),
				mutate((value) => {
					value.cursor.revision = 9007199254740992;
				}),
				mutate((value) => {
					value.nodes.push(value.nodes[0]);
				}),
				mutate((value) => {
					value.edges = [];
				}),
				mutate((value) => {
					value.cursor.approved = true;
				}),
				mutate((value) => {
					value.nodes[0] = ["array-not-object"];
				}),
				cli.stdout.replace('"runId":', '"run\\u0049d":"duplicate","runId":'),
				cli.stdout.replace(/\n$/, "\r\n"),
				cli.stdout.slice(0, -1),
				`\ufeff${cli.stdout}`,
				cli.stdout + cli.stdout,
				"x".repeat(262146),
			];
			for (const input of malformed) {
				const rejected = consume(input);
				expect(rejected.status).toBe(1);
				expect(rejected.stdout).toBe("");
				expect(rejected.stderr).toBe("workbench: invalid_observation\n");
			}
			expect(readFileSync(journalPath(f.runPath))).toEqual(journal);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
	60000,
);
