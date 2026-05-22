import type { DagNodeDefinition, DagNodeRouting } from "../orchestration/dag.js";
import { buildCapabilityAgentNodes, isCapabilityAgentNode } from "../orchestration/capability-agents.js";
import type { RunState } from "../contracts/orchestration.js";
import type { ActionAtom, GoalSpec, IntentCapabilityHints, SuccessCriterion } from "../contracts/goal.js";
import { actionAtomRouting, buildIntentFrameFromGoal, makeActionAtom } from "./intent-frame.js";

export function compileGoalToDagNodes(goal: GoalSpec): DagNodeDefinition[] {
  const intentFrame = buildIntentFrameFromGoal(goal);
  const capabilityHints = intentFrame.capabilityHints;
  const readOnly = capabilityHints.readOnly;
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
      priority: 100,
      cost: 1,
      routing: { actionAtom: actionAtomRouting(bootstrapAtom) },
    },
    {
      id: "goal-coordinator",
      name: "Plan strict intent DAG",
      role: "planner",
      dependsOn: ["bootstrap"],
      maxRetries: 1,
      priority: 90,
      cost: 1,
      outputs: [{ name: "planner execution plan", ref: "plan.md", gate: "summary" }],
      routing: goalActionRouting(planAtom, capabilityHints, {
        contextBudget: "normal",
        replanHint: { targetAtomId: planAtom.id, preserveEvidence: true },
      }),
    },
  ];

  const actionAtomNodes = compileActionAtomNodes(intentFrame.actionAtoms, capabilityHints);
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

  const artifactNodes: DagNodeDefinition[] = goal.expectedArtifacts.map((artifact, index) => {
    const atom = makeActionAtom({
      id: `atom-artifact-${index + 1}`,
      label: "produce-artifact",
      verb: readOnly ? "document" : "modify",
      object: artifact.name,
      evidenceTarget: artifact.path ?? artifact.name,
      doneCondition: `Artifact ${artifact.name} exists or has summary evidence`,
      source: "artifact",
      roleHint: readOnly ? "researcher" : "coder",
    });
    return {
      id: `artifact-${index + 1}`,
      name: `Produce artifact ${index + 1}`,
      role: readOnly ? "researcher" : "coder",
      dependsOn: ["goal-coordinator"],
      maxRetries: 2,
      priority: readOnly ? 55 : 65,
      cost: readOnly ? 1 : 2,
      outputs: [
        {
          name: artifact.name,
          ref: artifact.path,
          gate: readOnly ? "summary" : artifact.gate ?? "summary",
        },
      ],
      routing: goalActionRouting(atom, capabilityHints, {
        replanHint: {
          artifactRef: artifact.path ?? artifact.name,
          targetAtomId: atom.id,
          preserveEvidence: true,
        },
      }),
    };
  });

  if (actionAtomNodes.length > 0) {
    nodes.push(...actionAtomNodes);
  }
  if (artifactNodes.length > 0) {
    nodes.push(...artifactNodes);
  }
  if (capabilityAgentNodes.length > 0) {
    nodes.push(...capabilityAgentNodes);
  }

  const workDeps = uniqueStrings([
    ...actionAtomNodes.map((node) => node.id),
    ...artifactNodes.map((node) => node.id),
  ]);
  const criterionBaseDeps = uniqueStrings([
    ...(workDeps.length > 0 ? workDeps : ["goal-coordinator"]),
    ...capabilityAgentNodes.map((node) => node.id),
  ]);
  const criterionNodes = compileCriterionNodes(goal.successCriteria, capabilityHints, criterionBaseDeps);
  if (criterionNodes.length > 0) {
    nodes.push(...criterionNodes);
  }

  const verifyBaseDeps = uniqueStrings([
    ...(artifactNodes.length > 0 ? artifactNodes.map((n) => n.id) : ["goal-coordinator"]),
    ...actionAtomNodes.map((node) => node.id),
    ...criterionNodes.map((node) => node.id),
  ]);
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
    priority: 100,
    cost: 1,
    inputs: [
      ...verifyBaseDeps.map((from) => ({ name: `${from} result`, ref: "state.json", from })),
      ...capabilityInputs,
    ],
    outputs: [{ name: "verification report", gate: "review-pass" }],
    routing: goalActionRouting(verifyAtom, capabilityHints, {
      replanHint: { targetAtomId: verifyAtom.id, preserveEvidence: true },
    }),
  });

  return nodes;
}

function compileActionAtomNodes(
  atoms: ActionAtom[],
  capabilityHints: IntentCapabilityHints
): DagNodeDefinition[] {
  return atoms
    .filter((atom) => shouldPromoteActionAtom(atom))
    .map((atom, index) => {
      const role = roleForActionAtom(atom, capabilityHints.readOnly);
      return {
        id: `action-${index + 1}-${slugId(atom.label)}`,
        name: `Execute action atom: ${atom.label}`,
        role,
        dependsOn: ["goal-coordinator"],
        maxRetries: capabilityHints.readOnly ? 1 : 2,
        priority: priorityForActionAtom(atom),
        cost: costForRole(role, capabilityHints.readOnly),
        outputs: [{ name: `${atom.label} evidence`, gate: "summary" }],
        routing: goalActionRouting(atom, capabilityHints, {
          replanHint: { targetAtomId: atom.id, preserveEvidence: true },
        }),
      };
    });
}

function compileCriterionNodes(
  criteria: SuccessCriterion[],
  capabilityHints: IntentCapabilityHints,
  dependsOn: string[]
): DagNodeDefinition[] {
  return criteria.map((criterion, index) => {
    const atom = makeActionAtom({
      id: `atom-criterion-${index + 1}`,
      label: criterion.requirement === "required" ? "verify-required-criterion" : "verify-optional-criterion",
      verb: "verify",
      object: criterion.description,
      evidenceTarget: criterion.id,
      doneCondition: `${criterion.requirement} criterion has current passing evidence`,
      source: "criterion",
      roleHint: "reviewer",
    });
    return {
      id: `criterion-${index + 1}-${slugId(criterion.id)}`,
      name: `Verify criterion ${index + 1}`,
      role: "reviewer",
      dependsOn,
      maxRetries: 1,
      priority: criterion.requirement === "required" ? 75 + criterion.weight : 45 + criterion.weight,
      cost: 1,
      inputs: dependsOn.map((from) => ({
        name: `${from} evidence`,
        ref: "state.json",
        from,
        required: !from.startsWith("capability-"),
      })),
      outputs: [{
        name: criterion.id,
        ref: "verification report",
        gate: "review-pass",
        required: criterion.requirement === "required",
      }],
      routing: goalActionRouting(atom, capabilityHints, {
        replanHint: {
          criterionId: criterion.id,
          targetAtomId: atom.id,
          preserveEvidence: true,
        },
      }),
    };
  });
}

function withActionAtomRouting(node: DagNodeDefinition, atom: ActionAtom): DagNodeDefinition {
  return {
    ...node,
    routing: {
      ...(node.routing ?? {}),
      actionAtom: actionAtomRouting(atom),
      replanHint: {
        targetAtomId: atom.id,
        preserveEvidence: true,
        ...(node.routing?.replanHint ?? {}),
      },
    },
  };
}

function shouldPromoteActionAtom(atom: ActionAtom): boolean {
  if (atom.label === "bootstrap" || atom.label === "verify-evidence") return false;
  if (atom.label === "plan-intent-dag" || atom.label === "plan-execution") return false;
  if (atom.label === "produce-artifact") return false;
  return true;
}

function roleForActionAtom(atom: ActionAtom, readOnly: boolean): string {
  if (readOnly && (atom.roleHint === "coder" || atom.verb === "modify")) {
    return atom.source === "directive" ? "researcher" : "explorer";
  }
  if (atom.roleHint) return atom.roleHint;
  switch (atom.verb) {
    case "inspect":
      return "explorer";
    case "test":
      return "tester";
    case "verify":
    case "review":
      return "reviewer";
    case "document":
    case "research":
      return "researcher";
    case "plan":
    case "coordinate":
      return "planner";
    case "modify":
    case "integrate":
      return readOnly ? "researcher" : "coder";
    default:
      return "planner";
  }
}

function priorityForActionAtom(atom: ActionAtom): number {
  switch (atom.verb) {
    case "inspect":
      return 80;
    case "plan":
      return 78;
    case "modify":
    case "integrate":
      return 70;
    case "test":
    case "verify":
    case "review":
      return 68;
    case "document":
    case "research":
      return 58;
    default:
      return 50;
  }
}

function costForRole(role: string, readOnly: boolean): 1 | 2 | 3 {
  if (readOnly) return 1;
  if (role === "coder" || role === "tester") return 2;
  if (role === "architect") return 2;
  return 1;
}

function goalActionRouting(
  atom: ActionAtom,
  capabilityHints: IntentCapabilityHints,
  options: {
    contextBudget?: DagNodeRouting["contextBudget"];
    replanHint?: NonNullable<DagNodeRouting["replanHint"]>;
  } = {}
): DagNodeRouting {
  return {
    evidenceRequired: true,
    contextBudget: options.contextBudget ?? "small",
    readOnly: capabilityHints.readOnly,
    skills: capabilityHints.skills.length > 0 ? capabilityHints.skills : undefined,
    mcpServers: capabilityHints.mcpServers.length > 0 ? capabilityHints.mcpServers : undefined,
    tools: capabilityHints.tools.length > 0 ? capabilityHints.tools : undefined,
    hooks: capabilityHints.hooks.length > 0 ? capabilityHints.hooks : undefined,
    actionAtom: actionAtomRouting(atom),
    replanHint: options.replanHint,
  };
}

function slugId(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "node";
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
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
