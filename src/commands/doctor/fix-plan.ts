import type { McpDoctorFixReport } from "../mcp.js";
import type { KimiGlobalSyncReport } from "../../util/fs.js";

export type DoctorFixSeverity = "info" | "warn" | "error";
export type DoctorFixLevel = "safe" | "recommended" | "aggressive";
export type DoctorFixSafetyTier = DoctorFixLevel | "global";
export type DoctorFixOperationStatus = "planned" | "applied" | "skipped" | "blocked" | "failed";

export interface DoctorFixOperation {
  id: string;
  category: string;
  severity: DoctorFixSeverity;
  safetyTier: DoctorFixSafetyTier;
  status: DoctorFixOperationStatus;
  before?: unknown;
  after?: unknown;
  backupPath?: string;
  verifyCheck?: string;
  reason?: string;
}

export interface DoctorCheckSummary {
  warnings: number;
  errors: number;
}

export interface DoctorPostFixCheck {
  before: DoctorCheckSummary;
  after: DoctorCheckSummary;
  fixed: number;
  remainingWarnings: number;
  remainingErrors: number;
  requiresManualAction: boolean;
}

export interface DoctorFixPlan {
  operations: DoctorFixOperation[];
  changed: boolean;
  dryRun: boolean;
  backups: string[];
  manualActions: string[];
  postCheck?: DoctorPostFixCheck;
}

export interface DoctorFixReport {
  changed: boolean;
  actions: string[];
  skipped: string[];
  mcp?: McpDoctorFixReport;
  globalSync?: KimiGlobalSyncReport;
  backups?: string[];
  dryRun?: boolean;
  fixPlan: DoctorFixPlan;
}

export interface DoctorFixContext {
  dryRun: boolean;
  fixLevel: DoctorFixLevel;
  plan: DoctorFixPlan;
}

export function createDoctorFixPlan(dryRun: boolean): DoctorFixPlan {
  return {
    operations: [],
    changed: false,
    dryRun,
    backups: [],
    manualActions: [],
  };
}

export function addDoctorFixOperation(ctx: DoctorFixContext, operation: DoctorFixOperation): void {
  ctx.plan.operations.push(operation);
  if (operation.status === "applied") ctx.plan.changed = true;
  if (operation.backupPath && !ctx.plan.backups.includes(operation.backupPath)) {
    ctx.plan.backups.push(operation.backupPath);
  }
  if ((operation.status === "blocked" || operation.status === "failed") && operation.reason) {
    ctx.plan.manualActions.push(operation.reason);
  }
}

export function recordDoctorFix(
  ctx: DoctorFixContext,
  operation: Omit<DoctorFixOperation, "status" | "severity" | "safetyTier"> & {
    status?: DoctorFixOperationStatus;
    severity?: DoctorFixSeverity;
    safetyTier?: DoctorFixSafetyTier;
  }
): void {
  const requestedStatus = operation.status ?? "applied";
  const status = ctx.dryRun && requestedStatus === "applied" ? "planned" : requestedStatus;
  addDoctorFixOperation(ctx, {
    severity: operation.severity ?? "info",
    safetyTier: operation.safetyTier ?? ctx.fixLevel,
    ...operation,
    status,
  });
}

function operationToAction(operation: DoctorFixOperation): string | null {
  if (operation.status !== "applied" && operation.status !== "planned") return null;
  return operation.reason ?? `${operation.id} ${operation.status}`;
}

function operationToSkipped(operation: DoctorFixOperation): string | null {
  if (operation.status !== "skipped" && operation.status !== "blocked" && operation.status !== "failed") return null;
  return operation.reason ?? `${operation.id} ${operation.status}`;
}

export function createDoctorFixReport(
  ctx: DoctorFixContext,
  mcp?: McpDoctorFixReport,
  globalSync?: KimiGlobalSyncReport
): DoctorFixReport {
  const actions = ctx.plan.operations
    .map(operationToAction)
    .filter((message): message is string => typeof message === "string");
  const skipped = ctx.plan.operations
    .map(operationToSkipped)
    .filter((message): message is string => typeof message === "string");
  return {
    changed: ctx.plan.changed,
    actions,
    skipped,
    mcp,
    globalSync,
    backups: ctx.plan.backups,
    dryRun: ctx.dryRun,
    fixPlan: ctx.plan,
  };
}

export function summarizeDoctorChecks(results: { status: string }[]): DoctorCheckSummary {
  return {
    warnings: results.filter((r) => r.status === "warn").length,
    errors: results.filter((r) => r.status === "fail").length,
  };
}

export function buildDoctorPostFixCheck(beforeResults: { status: string }[], afterResults: { status: string }[], plan: DoctorFixPlan): DoctorPostFixCheck {
  const before = summarizeDoctorChecks(beforeResults);
  const after = summarizeDoctorChecks(afterResults);
  const beforeTotal = before.warnings + before.errors;
  const afterTotal = after.warnings + after.errors;
  return {
    before,
    after,
    fixed: Math.max(0, beforeTotal - afterTotal),
    remainingWarnings: after.warnings,
    remainingErrors: after.errors,
    requiresManualAction: plan.manualActions.length > 0 || after.errors > 0,
  };
}
