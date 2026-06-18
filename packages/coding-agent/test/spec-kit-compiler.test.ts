import { describe, expect, it } from "vitest";
import {
	collectSpecEvidencePaths,
	compileSpecKit,
	parseSpecRequirements,
	parseSpecTasks,
	validateSpecKit,
	validateTaskCompletionDependencies,
} from "../src/core/spec-kit/compiler.ts";

const specMarkdown = `# Feature Specification: Harness Control Plane V2

### R1 — Tamper-evident Event Ledger V2 (P0)

**Acceptance**:
1. Every event has IDs.
2. Hash chain verifies.

### R2 — Machine-compiled Spec Kit (P0)

**Acceptance**:
1. Every requirement maps to task/test/evidence.
`;

const tasksMarkdown = `# Tasks

- [ ] HCP-00 Remove provider hardcode
  > role: planner
  > deps: none
  > lane: spec-replay-qa
  > files: [\`specs/templates/plan-template.md\`]
  > verify: \`grep -R "Kimi is final writer" specs/templates && exit 1 || true\`
  > gate: command-pass
  > requirementIds: [R2]
  > risk: low

- [ ] HCP-01 Implement ledger
  > role: security
  > deps: HCP-00
  > lane: ledger-security-architect
  > files: [\`packages/coding-agent/src/core/harness-control-events.ts\`]
  > verify: \`cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/harness-control-events.test.ts\`
  > gate: command-pass
  > requirementIds: [R1]
  > risk: high
`;

describe("spec-kit compiler", () => {
	it("parses requirements and task metadata", () => {
		expect(parseSpecRequirements(specMarkdown)).toMatchObject([
			{ id: "R1", priority: "P0", acceptance: ["Every event has IDs.", "Hash chain verifies."] },
			{ id: "R2", priority: "P0", acceptance: ["Every requirement maps to task/test/evidence."] },
		]);
		expect(parseSpecTasks(tasksMarkdown)).toMatchObject([
			{
				id: "HCP-00",
				deps: [],
				files: ["specs/templates/plan-template.md"],
				gate: "command-pass",
				requirementIds: ["R2"],
			},
			{ id: "HCP-01", deps: ["HCP-00"], requirementIds: ["R1"] },
		]);
	});

	it("compiles traceability and stable spec hash", () => {
		const first = compileSpecKit({ specMarkdown, tasksMarkdown });
		const second = compileSpecKit({ specMarkdown, tasksMarkdown });

		expect(first.specHash).toBe(second.specHash);
		expect(first.traceability).toContainEqual(
			expect.objectContaining({ requirementId: "R1", taskIds: ["HCP-01"], evidenceGates: ["command-pass"] }),
		);
		expect(first.compiledDag).toContainEqual(expect.objectContaining({ id: "HCP-01", dependsOn: ["HCP-00"] }));
	});

	it("rejects missing dependency, missing gate, and missing traceability", () => {
		const invalidTasks = `# Tasks

- [ ] HCP-99 Invalid task
  > role: coder
  > deps: HCP-MISSING
  > files: []
  > verify: \`echo ok\`
  > requirementIds: [R1]
`;

		const result = validateSpecKit({ specMarkdown, tasksMarkdown: invalidTasks });

		expect(result.ok).toBe(false);
		expect(result.errors).toContain("Task HCP-99 missing evidence gate");
		expect(result.errors).toContain("Task HCP-99 depends on missing task HCP-MISSING");
		expect(result.errors).toContain("Requirement R2 has no linked task");
	});

	it("rejects provider-hardcoded authority text", () => {
		const result = validateSpecKit({
			specMarkdown,
			tasksMarkdown,
			templateMarkdown: "- **Authority**: Kimi is final writer/merger unless harness says otherwise.",
		});

		expect(result.ok).toBe(false);
		expect(result.errors).toContain("Provider-hardcoded authority: Kimi is final writer");
	});

	it("rejects completed tasks whose dependencies are incomplete", () => {
		const tasks = parseSpecTasks(`# Tasks

- [ ] HCP-01 Dependency
  > role: coder
  > deps: none
  > files: []
  > verify: \`echo ok\`
  > gate: command-pass
  > requirementIds: [R1]

- [x] HCP-02 Completed too early
  > role: coder
  > deps: HCP-01
  > files: []
  > verify: \`echo ok\`
  > gate: command-pass
  > requirementIds: [R1]
`);

		expect(validateTaskCompletionDependencies(tasks)).toEqual([
			"Task HCP-02 is completed but dependency HCP-01 is incomplete",
		]);
	});

	it("collects strict evidence paths from task files and verify text", () => {
		const tasks = parseSpecTasks(`# Tasks

- [x] HCP-15 Review
  > role: reviewer
  > deps: none
  > files: [\`.omk/runs/harness-control-plane-v2/result.json\`]
  > verify: \`write review artifact under .omk/runs/harness-control-plane-v2/review.md\`
  > gate: command-pass
  > requirementIds: [R1]
`);

		expect(collectSpecEvidencePaths(tasks)).toEqual([
			".omk/runs/harness-control-plane-v2/result.json",
			".omk/runs/harness-control-plane-v2/review.md",
		]);
	});
});
