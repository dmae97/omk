import type { ApprovalContext, ApprovalDecision, PolicyEngine } from "../contracts/safety.js";

export type ApprovalPolicy = "interactive" | "auto" | "yolo" | "block";

const SAFE_TOOLS = [
  "ReadFile", "Glob", "Grep", "SearchWeb", "FetchURL",
  "ctx_read", "ctx_tree", "ctx_search", "ctx_multi_read", "ctx_overview",
  "browser_snapshot", "list_console_messages", "browser_network_requests",
  "browser_console_messages", "browser_tabs", "browser_wait_for",
];

const DESTRUCTIVE_TOOLS = ["Shell", "WriteFile", "StrReplaceFile", "applyDiff", "browser_run_code_unsafe"];

export function decideApproval(
  policy: ApprovalPolicy,
  ctx: ApprovalContext
): ApprovalDecision {
  if (policy === "yolo") return "allow";
  if (policy === "block") return "block";
  if (policy === "auto") {
    if (SAFE_TOOLS.includes(ctx.tool)) return "allow";
    if (DESTRUCTIVE_TOOLS.includes(ctx.tool)) return "ask";
    return "ask";
  }
  // interactive
  if (DESTRUCTIVE_TOOLS.includes(ctx.tool)) return "ask";
  if (SAFE_TOOLS.includes(ctx.tool)) return "allow";
  return "ask";
}

export function createPolicyEngine(policy: ApprovalPolicy): PolicyEngine {
  return {
    async decide(ctx: ApprovalContext): Promise<ApprovalDecision> {
      return decideApproval(policy, ctx);
    },
  };
}
