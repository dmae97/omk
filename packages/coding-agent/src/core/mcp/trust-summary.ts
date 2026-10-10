import type { McpConfigLoadReport } from "./config.ts";

/** The part of a load report that is safe to show: no server configs, so no env values. */
export type McpProjectTrustSummary = Pick<McpConfigLoadReport, "project" | "skippedProjectServers">;

/** Copies only the trust fields out of a load report, for UI and SDK callers. */
export function projectTrustSummary(report: McpConfigLoadReport | undefined): McpProjectTrustSummary | undefined {
	return report ? { project: report.project, skippedProjectServers: report.skippedProjectServers } : undefined;
}
