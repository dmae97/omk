import type { DagNodeDefinition } from "../orchestration/dag.js";
import { buildCapabilityAgentNodes, isCapabilityAgentNode } from "../orchestration/capability-agents.js";
import type { RunState } from "../contracts/orchestration.js";
import type { GoalSpec } from "../contracts/goal.js";

export function compileGoalToDagNodes(goal: GoalSpec): DagNodeDefinition[] {
  const nodes: DagNodeDefinition[] = [
    {
      id: "bootstrap",
      name: `Prepare goal run: ${goal.title}`,
      role: "omk",
      dependsOn: [],
      maxRetries: 1,
    },
    {
      id: "goal-coordinator",
      name: `Plan goal execution: ${goal.title}`,
      role: "planner",
      dependsOn: ["bootstrap"],
      maxRetries: 1,
      outputs: [{ name: "planner execution plan", ref: "plan.md", gate: "summary" }],
      routing: { evidenceRequired: true, contextBudget: "normal" },
    },
  ];

  const capabilityAgentNodes = buildCapabilityAgentNodes({
    goal: `${goal.title}: ${goal.objective}`,
    dependsOn: ["goal-coordinator"],
    maxAgents: 3,
    seedId: "goal-capability-routing-seed",
    seedRole: "planner",
    seedName: `Route active MCP, skills, and hooks for goal: ${goal.title}`,
  });

  // Map expected artifacts to artifact nodes
  const artifactNodes: DagNodeDefinition[] = goal.expectedArtifacts.map((artifact, index) => ({
    id: `artifact-${index + 1}`,
    name: `Produce artifact: ${artifact.name}`,
    role: "coder",
    dependsOn: ["goal-coordinator"],
    maxRetries: 2,
    outputs: [
      {
        name: artifact.name,
        ref: artifact.path,
        gate: artifact.gate ?? "summary",
      },
    ],
    routing: { evidenceRequired: true },
  }));

  if (artifactNodes.length > 0) {
    nodes.push(...artifactNodes);
  }
  if (capabilityAgentNodes.length > 0) {
    nodes.push(...capabilityAgentNodes);
  }

  // Add a verify node that depends on all artifact nodes (or coordinator if no artifacts)
  const verifyBaseDeps = artifactNodes.length > 0 ? artifactNodes.map((n) => n.id) : ["goal-coordinator"];
  const capabilityInputs = capabilityAgentNodes.map((node) => ({
    name: node.outputs?.[0]?.name ?? node.name,
    ref: "state.json",
    from: node.id,
    required: !isCapabilityAgentNode(node),
  }));
  nodes.push({
    id: "goal-verify",
    name: `Verify goal success criteria: ${goal.title}`,
    role: "reviewer",
    dependsOn: [...verifyBaseDeps, ...capabilityAgentNodes.map((node) => node.id)],
    maxRetries: 1,
    inputs: [
      ...verifyBaseDeps.map((from) => ({ name: `${from} result`, ref: "state.json", from })),
      ...capabilityInputs,
    ],
    outputs: [{ name: "verification report", gate: "review-pass" }],
    routing: { evidenceRequired: true },
  });

  return nodes;
}

export function attachGoalToRunState(runState: RunState, goal: GoalSpec): RunState {
  return {
    ...runState,
    schemaVersion: 1,
    goalId: goal.goalId,
    goalSnapshot: {
      title: goal.title,
      objective: goal.objective,
      successCriteria: goal.successCriteria.map((c) => ({
        id: c.id,
        description: c.description,
        requirement: c.requirement,
      })),
    },
  };
}
