import * as os from "node:os";
import { theme } from "../../../modes/theme/theme";
import { shortenPath } from "../../../tools/render-utils";
import type { RenderedSegment, SegmentContext, StatusLineSegment, StatusLineSegmentId } from "./types";

export type { SegmentContext } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function withIcon(icon: string, text: string): string {
	return icon ? `${icon} ${text}` : text;
}

function formatTokens(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1000000) return `${Math.round(n / 1000)}k`;
	if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
	return `${Math.round(n / 1000000)}M`;
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) return `${hours}h${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m${seconds % 60}s`;
	return `${seconds}s`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Segment Implementations
// ═══════════════════════════════════════════════════════════════════════════

const piSegment: StatusLineSegment = {
	id: "pi",
	render(_ctx) {
		const content = theme.icon.pi ? `${theme.icon.pi} ` : "";
		return { content: theme.fg("accent", content), visible: true };
	},
};

const modelSegment: StatusLineSegment = {
	id: "model",
	render(ctx) {
		const state = ctx.session.state;
		const opts = ctx.options.model ?? {};

		let modelName = state.model?.name || state.model?.id || "no-model";
		if (modelName.startsWith("Claude ")) {
			modelName = modelName.slice(7);
		}

		let content = withIcon(theme.icon.model, modelName);

		// Add thinking level with dot separator
		if (opts.showThinkingLevel !== false && state.model?.reasoning) {
			const level = state.thinkingLevel || "off";
			if (level !== "off") {
				const thinkingText = theme.thinking[level as keyof typeof theme.thinking];
				if (thinkingText) {
					content += `${theme.sep.dot}${thinkingText}`;
				}
			}
		}

		return { content: theme.fg("statusLineModel", content), visible: true };
	},
};

const planModeSegment: StatusLineSegment = {
	id: "plan_mode",
	render(ctx) {
		const status = ctx.planMode;
		if (!status || (!status.enabled && !status.paused)) {
			return { content: "", visible: false };
		}

		const label = status.paused ? "Plan ⏸" : "Plan";
		const content = withIcon(theme.icon.plan, label);
		const color = status.paused ? "warning" : "accent";
		return { content: theme.fg(color, content), visible: true };
	},
};

const pathSegment: StatusLineSegment = {
	id: "path",
	render(ctx) {
		const opts = ctx.options.path ?? {};

		let pwd = process.cwd();

		if (opts.abbreviate !== false) {
			pwd = shortenPath(pwd);
		}
		if (opts.stripWorkPrefix !== false && pwd.startsWith("/work/")) {
			pwd = pwd.slice(6);
		}

		const maxLen = opts.maxLength ?? 40;
		if (pwd.length > maxLen) {
			const ellipsis = theme.format.ellipsis;
			const sliceLen = Math.max(0, maxLen - ellipsis.length);
			pwd = `${ellipsis}${pwd.slice(-sliceLen)}`;
		}

		const content = withIcon(theme.icon.folder, pwd);
		return { content: theme.fg("statusLinePath", content), visible: true };
	},
};

const gitSegment: StatusLineSegment = {
	id: "git",
	render(ctx) {
		const { branch, status } = ctx.git;
		if (!branch && !status) return { content: "", visible: false };

		const opts = ctx.options.git ?? {};
		const gitStatus = status;
		const isDirty = gitStatus && (gitStatus.staged > 0 || gitStatus.unstaged > 0 || gitStatus.untracked > 0);

		const showBranch = opts.showBranch !== false;
		let content = "";
		if (showBranch && branch) {
			content = withIcon(theme.icon.branch, branch);
		}

		// Add status indicators
		if (gitStatus) {
			const indicators: string[] = [];
			if (opts.showUnstaged !== false && gitStatus.unstaged > 0) {
				indicators.push(theme.fg("statusLineDirty", `*${gitStatus.unstaged}`));
			}
			if (opts.showStaged !== false && gitStatus.staged > 0) {
				indicators.push(theme.fg("statusLineStaged", `+${gitStatus.staged}`));
			}
			if (opts.showUntracked !== false && gitStatus.untracked > 0) {
				indicators.push(theme.fg("statusLineUntracked", `?${gitStatus.untracked}`));
			}
			if (indicators.length > 0) {
				const indicatorText = indicators.join(" ");
				if (!content && showBranch === false) {
					content = withIcon(theme.icon.git, indicatorText);
				} else {
					content += content ? ` ${indicatorText}` : indicatorText;
				}
			}
		}

		if (!content) return { content: "", visible: false };

		const colorName = isDirty ? "statusLineGitDirty" : "statusLineGitClean";
		return { content: theme.fg(colorName, content), visible: true };
	},
};

const subagentsSegment: StatusLineSegment = {
	id: "subagents",
	render(ctx) {
		if (ctx.subagentCount === 0) {
			return { content: "", visible: false };
		}
		const content = withIcon(theme.icon.agents, `${ctx.subagentCount}`);
		return { content: theme.fg("statusLineSubagents", content), visible: true };
	},
};

const tokenInSegment: StatusLineSegment = {
	id: "token_in",
	render(ctx) {
		const { input } = ctx.usageStats;
		if (!input) return { content: "", visible: false };

		const content = withIcon(theme.icon.input, formatTokens(input));
		return { content: theme.fg("statusLineSpend", content), visible: true };
	},
};

const tokenOutSegment: StatusLineSegment = {
	id: "token_out",
	render(ctx) {
		const { output } = ctx.usageStats;
		if (!output) return { content: "", visible: false };

		const content = withIcon(theme.icon.output, formatTokens(output));
		return { content: theme.fg("statusLineOutput", content), visible: true };
	},
};

const tokenTotalSegment: StatusLineSegment = {
	id: "token_total",
	render(ctx) {
		const { input, output, cacheRead, cacheWrite } = ctx.usageStats;
		const total = input + output + cacheRead + cacheWrite;
		if (!total) return { content: "", visible: false };

		const content = withIcon(theme.icon.tokens, formatTokens(total));
		return { content: theme.fg("statusLineSpend", content), visible: true };
	},
};

const costSegment: StatusLineSegment = {
	id: "cost",
	render(ctx) {
		const { cost } = ctx.usageStats;
		const state = ctx.session.state;
		const usingSubscription = state.model ? ctx.session.modelRegistry.isUsingOAuth(state.model) : false;

		if (!cost && !usingSubscription) {
			return { content: "", visible: false };
		}

		const costDisplay = usingSubscription ? "(sub)" : `$${cost.toFixed(2)}`;
		return { content: theme.fg("statusLineCost", costDisplay), visible: true };
	},
};

const contextPctSegment: StatusLineSegment = {
	id: "context_pct",
	render(ctx) {
		const pct = ctx.contextPercent;
		const window = ctx.contextWindow;

		const autoIcon = ctx.autoCompactEnabled && theme.icon.auto ? ` ${theme.icon.auto}` : "";
		const text = `${pct.toFixed(1)}%/${formatTokens(window)}${autoIcon}`;

		let content: string;
		if (pct > 90) {
			content = withIcon(theme.icon.context, theme.fg("error", text));
		} else if (pct > 70) {
			content = withIcon(theme.icon.context, theme.fg("warning", text));
		} else {
			const colored = theme.fg("statusLineContext", text);
			content = withIcon(theme.icon.context, colored);
		}

		return { content, visible: true };
	},
};

const contextTotalSegment: StatusLineSegment = {
	id: "context_total",
	render(ctx) {
		const window = ctx.contextWindow;
		if (!window) return { content: "", visible: false };
		return {
			content: theme.fg("statusLineContext", withIcon(theme.icon.context, formatTokens(window))),
			visible: true,
		};
	},
};

const timeSpentSegment: StatusLineSegment = {
	id: "time_spent",
	render(ctx) {
		const elapsed = Date.now() - ctx.sessionStartTime;
		if (elapsed < 1000) return { content: "", visible: false };

		return { content: withIcon(theme.icon.time, formatDuration(elapsed)), visible: true };
	},
};

const timeSegment: StatusLineSegment = {
	id: "time",
	render(ctx) {
		const opts = ctx.options.time ?? {};
		const now = new Date();

		let hours = now.getHours();
		let suffix = "";
		if (opts.format === "12h") {
			suffix = hours >= 12 ? "pm" : "am";
			hours = hours % 12 || 12;
		}

		const mins = now.getMinutes().toString().padStart(2, "0");
		let timeStr = `${hours}:${mins}`;
		if (opts.showSeconds) {
			timeStr += `:${now.getSeconds().toString().padStart(2, "0")}`;
		}
		timeStr += suffix;

		return { content: withIcon(theme.icon.time, timeStr), visible: true };
	},
};

const sessionSegment: StatusLineSegment = {
	id: "session",
	render(ctx) {
		const sessionManager = ctx.session.sessionManager;
		const sessionId = sessionManager?.getSessionId?.();
		const display = sessionId?.slice(0, 8) || "new";

		return { content: withIcon(theme.icon.session, display), visible: true };
	},
};

const hostnameSegment: StatusLineSegment = {
	id: "hostname",
	render(_ctx) {
		const name = os.hostname().split(".")[0];
		return { content: withIcon(theme.icon.host, name), visible: true };
	},
};

const cacheReadSegment: StatusLineSegment = {
	id: "cache_read",
	render(ctx) {
		const { cacheRead } = ctx.usageStats;
		if (!cacheRead) return { content: "", visible: false };

		const parts = [theme.icon.cache, theme.icon.input, formatTokens(cacheRead)].filter(Boolean);
		const content = parts.join(" ");
		return { content: theme.fg("statusLineSpend", content), visible: true };
	},
};

const cacheWriteSegment: StatusLineSegment = {
	id: "cache_write",
	render(ctx) {
		const { cacheWrite } = ctx.usageStats;
		if (!cacheWrite) return { content: "", visible: false };

		const parts = [theme.icon.cache, theme.icon.output, formatTokens(cacheWrite)].filter(Boolean);
		const content = parts.join(" ");
		return { content: theme.fg("statusLineOutput", content), visible: true };
	},
};

// ═══════════════════════════════════════════════════════════════════════════
// Segment Registry
// ═══════════════════════════════════════════════════════════════════════════

export const SEGMENTS: Record<StatusLineSegmentId, StatusLineSegment> = {
	pi: piSegment,
	model: modelSegment,
	plan_mode: planModeSegment,
	path: pathSegment,
	git: gitSegment,
	subagents: subagentsSegment,
	token_in: tokenInSegment,
	token_out: tokenOutSegment,
	token_total: tokenTotalSegment,
	cost: costSegment,
	context_pct: contextPctSegment,
	context_total: contextTotalSegment,
	time_spent: timeSpentSegment,
	time: timeSegment,
	session: sessionSegment,
	hostname: hostnameSegment,
	cache_read: cacheReadSegment,
	cache_write: cacheWriteSegment,
};

export function renderSegment(id: StatusLineSegmentId, ctx: SegmentContext): RenderedSegment {
	const segment = SEGMENTS[id];
	if (!segment) {
		return { content: "", visible: false };
	}
	return segment.render(ctx);
}

export const ALL_SEGMENT_IDS: StatusLineSegmentId[] = Object.keys(SEGMENTS) as StatusLineSegmentId[];
