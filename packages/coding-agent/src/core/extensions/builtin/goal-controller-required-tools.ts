/**
 * Spec 104 phase 3: the goal controller as the required-tool contract producer.
 *
 * Required tools come only from what an approved check explicitly declares
 * (`/goal verify --requires <tool>[,<tool>] <command>`); nothing is inferred from the
 * command, the prompt or the tools a check used. The contract of the active goal's segment
 * (`taskSegmentId` = goal key) goes to the session's admission host; a turn that cannot carry
 * a required tool comes back as `insufficient/required_capability_missing` and blocks
 * completion. Everything here is inert with `OMK_REQUIRED_TOOLS` off: no parsing, no
 * listener, no contract, no entries.
 */
import { DurableGoalError, type DurableGoalSnapshot } from "../../durable-goal.ts";
import type { GoalAcceptance } from "../../goal-acceptance.ts";
import { goalKeyOf } from "../../goal-verification.ts";
import {
	factFromRequiredCapabilityUnavailable,
	isRequiredToolsEnabled,
	RequiredCapabilityUnavailable,
	type RequiredToolContract,
} from "../../required-tools.ts";
import {
	onRequiredCapability,
	publishRequiredToolContract,
	type RequiredCapabilityReport,
} from "../../required-tools-channel.ts";
import { isTaskResultEnabled } from "../../task-result.ts";
import { currentTaskRunId, publishHostTaskFact } from "../../task-result-collector.ts";
import type { ExtensionAPI } from "../types.ts";

const REQUIRES = /^--requires(?:=|\s+)(\S+)(?:\s+|$)/;
/** An MCP tool name as the session lists it: `server__tool`. */
const TOOL_NAME = /^[A-Za-z0-9.-][A-Za-z0-9_.-]{0,62}__[A-Za-z0-9_.-]{1,63}$/;
const USAGE = "usage: /goal verify --requires <server__tool>[,<server__tool>] <command>";

export interface RequiredToolsDeclaration {
	readonly command: string;
	readonly tools: readonly string[];
}

/** Split an explicit `--requires a,b` declaration off a `/goal verify` command; flag off returns it unchanged. */
export function parseRequiredToolsDeclaration(command: string): RequiredToolsDeclaration {
	if (!isRequiredToolsEnabled()) return { command, tools: [] };
	const match = REQUIRES.exec(command);
	if (!match) return { command, tools: [] };
	const tools = (match[1] ?? "").split(",").filter((name) => name.length > 0);
	const rest = command.slice(match[0].length).trim();
	if (tools.length === 0 || rest.length === 0) throw new DurableGoalError("invalid-input", USAGE);
	const invalid = tools.filter((name) => !TOOL_NAME.test(name));
	if (invalid.length > 0) {
		// Refused, never silently dropped: a declaration that names nothing usable must not approve the check.
		throw new DurableGoalError(
			"invalid-input",
			`--requires names must be MCP tools in server__tool form; invalid: ${invalid.join(", ").slice(0, 200)}. ${USAGE}`,
		);
	}
	return { command: rest, tools };
}

type Omk = Pick<ExtensionAPI, "appendEntry"> & Partial<Pick<ExtensionAPI, "events">>;

export class GoalRequiredTools {
	private readonly omk: Omk;
	private readonly acceptance: GoalAcceptance;
	/** The goal whose contract was published last; reports for other segments are ignored. */
	private segment: { readonly goal: DurableGoalSnapshot; readonly requiredCount: number } | undefined;
	private published = "";
	private gapOpen = false;

	constructor(omk: Omk, acceptance: GoalAcceptance) {
		this.omk = omk;
		this.acceptance = acceptance;
		if (this.enabled && omk.events) onRequiredCapability(omk.events, (report) => this.onReport(report));
	}

	get enabled(): boolean {
		return this.omk.events !== undefined && isRequiredToolsEnabled();
	}

	/** Publish the contract of `goal` (open goals with declared tools only), or clear it. */
	sync(goal: DurableGoalSnapshot | null | undefined): void {
		const events = this.omk.events;
		if (!events || !isRequiredToolsEnabled()) return;
		const open = goal && goal.status !== "completed" && goal.status !== "cleared" ? goal : undefined;
		const tools = open ? this.acceptance.requiredTools(open) : [];
		const contract: RequiredToolContract | undefined =
			open && tools.length > 0
				? { taskSegmentId: goalKeyOf(open), tools: new Set(tools), source: "acceptance" }
				: undefined;
		this.segment = open && contract ? { goal: open, requiredCount: tools.length } : undefined;
		const signature = contract ? JSON.stringify([contract.taskSegmentId, ...tools]) : "";
		if (signature === this.published) return;
		this.published = signature;
		this.gapOpen = false;
		publishRequiredToolContract(events, contract);
	}

	private onReport(report: RequiredCapabilityReport): void {
		const segment = this.segment;
		const events = this.omk.events;
		if (!segment || !events || goalKeyOf(segment.goal) !== report.taskSegmentId) return;
		const { goal, requiredCount } = segment;
		if (report.state === "present") {
			if (!this.gapOpen) return;
			this.gapOpen = false;
			this.acceptance.recordRequiredCapabilityPresent(goal);
			this.omk.appendEntry("goal_required_capability", { goalId: goal.ref.id, state: "present", requiredCount });
			return;
		}
		this.gapOpen = true;
		this.acceptance.recordRequiredCapabilityMissing(goal, report.missing);
		// Trace counts only: no tool names, command or prompt text.
		this.omk.appendEntry("goal_required_capability", {
			goalId: goal.ref.id,
			state: "missing",
			kind: report.kind,
			missingCount: report.missing.length,
			requiredCount,
		});
		if (!isTaskResultEnabled()) return;
		const error = new RequiredCapabilityUnavailable(report.taskSegmentId, report.missing, report.kind);
		publishHostTaskFact(events, factFromRequiredCapabilityUnavailable(error), currentTaskRunId(events));
	}
}
