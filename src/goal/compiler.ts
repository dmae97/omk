import type { DagNodeDefinition } from "../orchestration/dag.js";
import { buildCapabilityAgentNodes, isCapabilityAgentNode } from "../orchestration/capability-agents.js";
import type { RunState } from "../contracts/orchestration.js";
import type { ActionAtom, GoalSpec } from "../contracts/goal.js";
import { actionAtomRouting, buildIntentFrameFromGoal, makeActionAtom } from "./intent-frame.js";

export function compileGoalToDagNodes(goal: GoalSpec): DagNodeDefinition[] {
  const intentFrame = buildIntentFrameFromGoal(goal);
  const bootstrapAtom = intentFrame.actionAtoms.find((atom) => atom.label === "bootstrap") ?? makeActionAtom({
    id: "atom-bootstrap",
    label: "bootstrap",
    verb: "bootstrap",
    object: "goal runtime",
    evidenceTarget: "state.json",
    doneCondition: "Goal runtime state is initialized",
  });
  const planAtom = intentFrame.actionAtoms.find((atom) => atom.label === "plan-intent-dag" || atom.label === "plan-execution") ?? makeActionAtom({
    id: "atom-plan",
    label: "plan-intent-dag",
    verb: "plan",
    object: "intent DAG",
    evidenceTarget: "plan.md",
    doneCondition: "Planner decomposes the intent into evidence-backed actions",
  });
  const verifyAtom = intentFrame.actionAtoms.find((atom) => atom.label === "verify-evidence") ?? makeActionAtom({
    id: "atom-verify",
    label: "verify-evidence",
    verb: "verify",
    object: "goal evidence",
    evidenceTarget: "verification report",
    doneCondition: "Success criteria are verified",
  });
  const nodes: DagNodeDefinition[] = [
    {
      id: "bootstrap",
      name: "Prepare goal runtime",
      role: "omk",
      dependsOn: [],
      maxRetries: 1,
      routing: { actionAtom: actionAtomRouting(bootstrapAtom) },
    },
    {
      id: "goal-coordinator",
      name: "Plan strict intent DAG",
      role: "planner",
      dependsOn: ["bootstrap"],
      maxRetries: 1,
      outputs: [{ name: "planner execution plan", ref: "plan.md", gate: "summary" }],
      routing: { evidenceRequired: true, contextBudget: "normal", actionAtom: actionAtomRouting(planAtom) },
    },
  ];

  const capabilitySeed = intentFrame.actionAtoms.map((atom) => atom.label).join(", ");
  const capabilityAgentNodes = buildCapabilityAgentNodes({
    goal: capabilitySeed || "strict intent action digest",
    dependsOn: ["goal-coordinator"],
    maxAgents: 3,
    seedId: "goal-capability-routing-seed",
    seedRole: "planner",
    seedName: "Route active MCP, skills, and hooks for intent actions",
  }).map((node) => withActionAtomRouting(node, makeActionAtom({
    id: `atom-${node.id}`,
    label: node.routing?.routeSource ? `route-${node.routing.routeSource}` : "route-capabilities",
    verb: "route",
    object: "active capability inventory",
    evidenceTarget: node.outputs?.[0]?.name ?? "capability routing plan",
    doneCondition: "Relevant MCP, skills, and hooks are bounded to the current action atom",
    source: "runtime",
  })));

  // Map expected artifacts to artifact nodes
  const artifactNodes: DagNodeDefinition[] = goal.expectedArtifacts.map((artifact, index) => {
    const atom = makeActionAtom({
      id: `atom-artifact-${index + 1}`,
      label: "produce-artifact",
      verb: "modify",
      object: artifact.name,
      evidenceTarget: artifact.path ?? artifact.name,
      doneCondition: `Artifact ${artifact.name} exists or has summary evidence`,
      source: "artifact",
      roleHint: "coder",
    });
    return {
      id: `artifact-${index + 1}`,
      name: `Produce artifact ${index + 1}`,
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
      routing: { evidenceRequired: true, actionAtom: actionAtomRouting(atom) },
    };
  });

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
    name: "Verify goal evidence",
    role: "reviewer",
    dependsOn: [...verifyBaseDeps, ...capabilityAgentNodes.map((node) => node.id)],
    maxRetries: 1,
    inputs: [
      ...verifyBaseDeps.map((from) => ({ name: `${from} result`, ref: "state.json", from })),
      ...capabilityInputs,
    ],
    outputs: [{ name: "verification report", gate: "review-pass" }],
    routing: { evidenceRequired: true, actionAtom: actionAtomRouting(verifyAtom) },
  });

  return nodes;
}

function withActionAtomRouting(node: DagNodeDefinition, atom: ActionAtom): DagNodeDefinition {
  return {
    ...node,
    routing: {
      ...(node.routing ?? {}),
      actionAtom: actionAtomRouting(atom),
    },
  };
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
