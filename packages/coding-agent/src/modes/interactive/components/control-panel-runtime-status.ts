import type { AgentSession } from "../../../core/agent-session.ts";
import { getHeadroomRuntimeStatus } from "../../../core/context-budget-headroom.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { loadMcpInventory } from "../../../core/mcp-inventory.ts";
import { evaluatePiPackageIntake } from "../../../core/pi-package-intake.ts";
import type { SessionManager } from "../../../core/session-manager.ts";
import { getCurrentTodoState } from "../../../core/todo-runtime-state.ts";
import type { ControlPanelStatusSnapshot } from "./control-panel-layout.ts";
import { formatCwdForFooter } from "./footer.ts";

export function createControlPanelStatusSnapshot(
	session: AgentSession,
	sessionManager: SessionManager,
	footerData?: ReadonlyFooterDataProvider,
): ControlPanelStatusSnapshot {
	const contextUsage = session.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? session.state.model?.contextWindow ?? 0;
	const headroom = getHeadroomRuntimeStatus();
	const packageIntake = evaluatePiPackageIntake().summary;
	const ansiColorState = process.env.NO_COLOR ? "off" : "on";
	const cwdLabel = formatCwdForFooter(sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
	return {
		modelId: session.state.model?.id,
		modelProvider: session.state.model?.provider,
		thinkingLevel: session.state.thinkingLevel ?? "off",
		contextPercent: contextUsage?.percent ?? null,
		contextWindowTokens: contextWindow,
		contextTokens: contextUsage?.tokens ?? null,
		headroomStatus: headroom.policyId,
		optimizerPolicy: headroom.selector,
		mcpCount: loadMcpInventory(sessionManager.getCwd()).entries.length,
		skillCount: session.resourceLoader.getSkills().skills.length,
		packageIntake,
		cwdLabel,
		gitBranch: footerData?.getGitBranch(),
		todoState: getCurrentTodoState(),
		runtimeState: "ready",
		routeState: "active",
		evidenceState: "tracking",
		controlState: "ready",
		dagOrchestrationState: "DAG:omk-parallel-orchestrator",
		ansiColorState,
		startupState: "linked",
		linkState: "ready",
		sidebarState: "pinned",
	};
}
