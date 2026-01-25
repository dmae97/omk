import { resolvePlanUrlToPath } from "@oh-my-pi/pi-coding-agent/internal-urls";
import type { ToolSession } from ".";
import { resolveToCwd } from "./path-utils";
import { ToolError } from "./tool-errors";

const PLAN_URL_PREFIX = "plan://";

export function resolvePlanPath(session: ToolSession, targetPath: string): string {
	if (!targetPath.startsWith(PLAN_URL_PREFIX)) {
		return resolveToCwd(targetPath, session.cwd);
	}

	const settingsManager = session.settingsManager;
	if (!settingsManager) {
		throw new ToolError("Plan mode: settings manager unavailable for plan path resolution.");
	}

	return resolvePlanUrlToPath(targetPath, {
		getPlansDirectory: settingsManager.getPlansDirectory.bind(settingsManager),
		cwd: session.cwd,
	});
}

export function enforcePlanModeWrite(
	session: ToolSession,
	targetPath: string,
	options?: { rename?: string; op?: "create" | "update" | "delete" },
): void {
	const state = session.getPlanModeState?.();
	if (!state?.enabled) return;

	const resolvedTarget = resolvePlanPath(session, targetPath);
	const resolvedPlan = resolvePlanPath(session, state.planFilePath);

	if (options?.rename) {
		throw new ToolError("Plan mode: renaming files is not allowed.");
	}

	if (options?.op === "delete") {
		throw new ToolError("Plan mode: deleting files is not allowed.");
	}

	if (resolvedTarget !== resolvedPlan) {
		throw new ToolError(`Plan mode: only the plan file may be modified (${state.planFilePath}).`);
	}
}
