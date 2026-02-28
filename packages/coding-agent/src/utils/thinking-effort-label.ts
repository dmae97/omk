import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";

const COMPACT_THINKING_EFFORT_LABEL: Record<ThinkingLevel, string> = {
	off: "off",
	minimal: "min",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
};

export function formatThinkingEffortLabel(level: ThinkingLevel): string {
	return COMPACT_THINKING_EFFORT_LABEL[level];
}
