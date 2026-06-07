/**
 * Enhanced Orchestration Modes — think, mcp, skills, variant
 *
 * 단일 모델 DAG subagents 알고리즘 고도화:
 *  - think:  CoT/추론 트레이싱 (thinking traces)
 *  - mcp:    Model Context Protocol 서버 라이브 바인딩
 *  - skills: 스킬 자동 할당 + 사용 증거 추적
 *  - variant: 동일 작업에 여러 variant 실행 → 최적 결과 선택
 */

import type { DagNode, DagNodeRouting } from "./dag.js";

// ─── 모드 정의 ────────────────────────────────────────────────────────────

export type EnhancedMode = "think" | "mcp" | "skills" | "variant";

export const ALL_ENHANCED_MODES: readonly EnhancedMode[] = [
  "think", "mcp", "skills", "variant",
];

export interface EnhancedModeConfig {
  /** 활성화된 모드 목록 */
  modes: readonly EnhancedMode[];
  /** variant 모드일 때 실행할 variant 수 (기본 3) */
  variantCount: number;
  /** variant 선택 전략 */
  variantStrategy: "majority-vote" | "best-score" | "first-pass" | "ensemble";
  /** thinking trace verbosity */
  thinkingLevel: "brief" | "normal" | "verbose";
  /** MCP 서버 목록 (빈 배열이면 discovery 자동) */
  mcpServers: readonly string[];
  /** Skills 강제 할당 (빈 배열이면 auto-assign) */
  forcedSkills: readonly string[];
  /** Hooks 강제 할당 (빈 배열이면 auto-assign) */
  forcedHooks: readonly string[];
}

export const DEFAULT_ENHANCED_CONFIG: EnhancedModeConfig = {
  modes: ["think", "mcp", "skills"],
  variantCount: 3,
  variantStrategy: "best-score",
  thinkingLevel: "normal",
  mcpServers: [],
  forcedSkills: [],
  forcedHooks: [],
};

export const FULL_ENHANCED_CONFIG: EnhancedModeConfig = {
  modes: ["think", "mcp", "skills", "variant"],
  variantCount: 3,
  variantStrategy: "ensemble",
  thinkingLevel: "verbose",
  mcpServers: [],
  forcedSkills: [],
  forcedHooks: [],
};

// ─── Think 모드 추론 트레이스 ──────────────────────────────────────────────

export interface ThinkingTrace {
  nodeId: string;
  runId: string;
  variantIndex?: number;
  timestamp: string;
  content: string;
  step: number;
}

export interface ThinkingSession {
  nodeId: string;
  runId: string;
  variantIndex: number;
  traces: ThinkingTrace[];
  startedAt: string;
  completedAt?: string;
}

export function createThinkingSession(
  nodeId: string,
  runId: string,
  variantIndex = 0
): ThinkingSession {
  return {
    nodeId,
    runId,
    variantIndex,
    traces: [],
    startedAt: new Date().toISOString(),
  };
}

export function addThinkingTrace(
  session: ThinkingSession,
  content: string
): ThinkingTrace {
  const trace: ThinkingTrace = {
    nodeId: session.nodeId,
    runId: session.runId,
    variantIndex: session.variantIndex,
    timestamp: new Date().toISOString(),
    content,
    step: session.traces.length + 1,
  };
  session.traces.push(trace);
  return trace;
}

// ─── MCP 모드 서버 바인딩 ──────────────────────────────────────────────────

export interface McpServerBinding {
  serverName: string;
  transport: "stdio" | "streamable-http";
  command?: string;
  args?: string[];
  url?: string;
  capabilities: string[];
  status: "connected" | "disconnected" | "error";
  lastActivityAt?: string;
}

export function buildMcpBindingsForNode(
  node: DagNode,
  availableServers: readonly McpServerBinding[]
): McpServerBinding[] {
  const wanted = node.routing?.mcpServers ?? [];
  if (wanted.length === 0) return [];

  return wanted
    .map((name) => availableServers.find((s) => s.serverName === name))
    .filter((s): s is McpServerBinding => s !== undefined);
}

// ─── Skills 모드 할당 증거 ─────────────────────────────────────────────────

export interface SkillEvidence {
  skillName: string;
  nodeId: string;
  runId: string;
  used: boolean;
  evidenceRef?: string;
  evidenceGate?: string;
  assignedAt: string;
}

export function createSkillEvidence(
  skillName: string,
  nodeId: string,
  runId: string
): SkillEvidence {
  return {
    skillName,
    nodeId,
    runId,
    used: false,
    assignedAt: new Date().toISOString(),
  };
}

// ─── Variant 모드 ──────────────────────────────────────────────────────────

export interface NodeVariant {
  index: number;
  node: DagNode;
  /** variant-specific routing override */
  routingOverride: Partial<DagNodeRouting>;
  priority: number;
  assignedModel?: string;
}

export interface VariantResult {
  variant: NodeVariant;
  success: boolean;
  score: number;
  stdout: string;
  stderr: string;
  thinkingSession?: ThinkingSession;
  skillEvidences: SkillEvidence[];
  metadata?: Record<string, unknown>;
}

export interface VariantSelection {
  selected: VariantResult;
  allResults: VariantResult[];
  strategy: EnhancedModeConfig["variantStrategy"];
  rationale: string;
}

export function createNodeVariants(
  node: DagNode,
  count: number,
  modeConfig: EnhancedModeConfig
): NodeVariant[] {
  if (!modeConfig.modes.includes("variant") || count <= 1) {
    return [
      {
        index: 0,
        node,
        routingOverride: {},
        priority: node.priority ?? 0,
      },
    ];
  }

  return Array.from({ length: count }, (_, i) => ({
    index: i,
    node: { ...node, id: `${node.id}-v${i}` },
    routingOverride: {
      ...(i > 0
        ? {
            providerModel: variantModelHint(node, i),
            contextBudget: "normal" as const,
          }
        : {}),
    },
    priority: (node.priority ?? 0) + (count - i),
    assignedModel: variantModelHint(node, i),
  }));
}

function variantModelHint(node: DagNode, index: number): string | undefined {
  const baseModel = node.routing?.providerModel ?? node.routing?.assignedModel;
  if (!baseModel || index === 0) return baseModel;
  // variant 1, 2 에 대해 다른 temperature/model hint
  const hints = [
    baseModel,
    `${baseModel}-high` as string,
    `${baseModel}-creative` as string,
  ];
  return hints[index] ?? baseModel;
}

export function selectBestVariant(
  results: VariantResult[],
  strategy: EnhancedModeConfig["variantStrategy"]
): VariantSelection {
  if (results.length === 0) {
    throw new Error("No variant results to select from");
  }

  const successful = results.filter((r) => r.success);
  const candidates = successful.length > 0 ? successful : results;

  switch (strategy) {
    case "majority-vote": {
      // 점수가 가장 많이 동의된 variant 선택
      const sorted = [...candidates].sort((a, b) => b.score - a.score);
      return {
        selected: sorted[0],
        allResults: results,
        strategy,
        rationale: `Majority vote selected variant ${sorted[0].variant.index} with score ${sorted[0].score} out of ${results.length} variants (${successful.length} successful)`,
      };
    }

    case "best-score":
    default: {
      const best = candidates.reduce((best, cur) =>
        cur.score > best.score ? cur : best
      );
      return {
        selected: best,
        allResults: results,
        strategy,
        rationale: `Best-score selected variant ${best.variant.index} with score ${best.score}`,
      };
    }

    case "first-pass": {
      const first = candidates[0];
      return {
        selected: first,
        allResults: results,
        strategy,
        rationale: `First-pass selected variant ${first.variant.index}`,
      };
    }

    case "ensemble": {
      // Ensemble: 모든 결과의 점수를 평균화하여 가장 안정적인 variant 선택
      if (candidates.length <= 1) {
        return {
          selected: candidates[0],
          allResults: results,
          strategy,
          rationale: `Ensemble with single candidate (${results.length} total, ${successful.length} successful)`,
        };
      }
      const scored = candidates.map((r) => {
        const avgScore =
          candidates.reduce((sum, c) => sum + c.score, 0) / candidates.length;
        const stability = 1 - Math.abs(r.score - avgScore) / Math.max(avgScore, 1);
        return { ...r, ensembleScore: r.score * 0.6 + stability * 0.4 };
      });
      const best = scored.reduce((best, cur) =>
        (cur as { ensembleScore: number }).ensembleScore >
        (best as { ensembleScore: number }).ensembleScore
          ? cur
          : best
      );
      return {
        selected: best,
        allResults: results,
        strategy,
        rationale: `Ensemble selected variant ${best.variant.index} (ensemble score ${(best as { ensembleScore: number }).ensembleScore.toFixed(2)} from ${candidates.length} candidates)`,
      };
    }
  }
}

// ─── 모드별 노드 라우팅 인젝션 ────────────────────────────────────────────

export interface ModeRoutingInjection {
  /** think 모드 추론 프롬프트 확장 */
  reasoningPrompt?: string;
  /** think 모드 생각할 시간 (ms) */
  thinkingBudgetMs?: number;
  /** MCP 서버 목록 */
  mcpServers: string[];
  /** 스킬 목록 */
  skills: string[];
  /** 훅 목록 */
  hooks: string[];
  /** 툴 목록 */
  tools: string[];
  /** MCP 필수 여부 */
  requiresMcp: boolean;
  /** 툴 콜링 필수 여부 */
  requiresToolCalling: boolean;
  /** Evidence 필수 여부 */
  evidenceRequired: boolean;
}

export function buildModeRoutingInjection(
  node: DagNode,
  modeConfig: EnhancedModeConfig,
  nodeSkills: string[],
  nodeMcpServers: string[],
  nodeHooks: string[],
  nodeTools: string[]
): ModeRoutingInjection {
  const hasThink = modeConfig.modes.includes("think");
  const hasMcp = modeConfig.modes.includes("mcp");
  const hasSkills = modeConfig.modes.includes("skills");

  return {
    reasoningPrompt: hasThink
      ? buildReasoningPrompt(node, modeConfig.thinkingLevel)
      : undefined,
    thinkingBudgetMs: hasThink ? resolveThinkingBudgetMs(node) : undefined,
    mcpServers:
      hasMcp && nodeMcpServers.length > 0
        ? nodeMcpServers
        : hasMcp
          ? [...modeConfig.mcpServers]
          : nodeMcpServers,
    skills: hasSkills ? nodeSkills : [],
    hooks: hasSkills ? nodeHooks : [],
    tools: hasSkills ? nodeTools : [],
    requiresMcp: hasMcp,
    requiresToolCalling: hasMcp || hasSkills,
    evidenceRequired: hasSkills || hasThink,
  };
}

function buildReasoningPrompt(
  node: DagNode,
  level: EnhancedModeConfig["thinkingLevel"]
): string {
  const base = `You are an expert ${node.role} agent. Think step-by-step before acting.`;

  switch (level) {
    case "verbose":
      return `${base}
1. ANALYZE: Understand the task deeply — identify constraints, edge cases, and dependencies.
2. PLAN: Outline your approach with clear steps and decision points.
3. REASON: For each step, explain why you chose this approach over alternatives.
4. EXECUTE: Carry out the plan, checking intermediate results.
5. VERIFY: Confirm the output satisfies the requirements. Flag any remaining concerns.`;
    case "normal":
    default:
      return `${base}
1. Understand the task and its constraints.
2. Plan your approach before acting.
3. Execute step-by-step, verifying each step.
4. Confirm the final output meets requirements.`;
    case "brief":
      return `${base} Think through your approach before executing.`;
  }
}

function resolveThinkingBudgetMs(node: DagNode): number {
  // role 기반 thinking budget
  const budgets: Record<string, number> = {
    planner: 30000,
    architect: 30000,
    security: 25000,
    reviewer: 20000,
    qa: 20000,
    tester: 20000,
    coder: 15000,
    debugger: 15000,
    researcher: 20000,
    explorer: 15000,
    integrator: 10000,
    aggregator: 15000,
  };
  return budgets[node.role] ?? 10000;
}
