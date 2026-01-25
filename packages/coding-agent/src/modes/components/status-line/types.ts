import type {
	StatusLinePreset,
	StatusLineSegmentId,
	StatusLineSegmentOptions,
	StatusLineSeparatorStyle,
	StatusLineSettings,
} from "../../../config/settings-manager";
import type { AgentSession } from "../../../session/agent-session";

// Re-export types from settings-manager (single source of truth)
export type {
	StatusLinePreset,
	StatusLineSegmentId,
	StatusLineSegmentOptions,
	StatusLineSeparatorStyle,
	StatusLineSettings,
};

// ═══════════════════════════════════════════════════════════════════════════
// Segment Rendering
// ═══════════════════════════════════════════════════════════════════════════

export type RGB = readonly [number, number, number];

export interface SegmentContext {
	session: AgentSession;
	width: number;
	options: StatusLineSegmentOptions;
	planMode: {
		enabled: boolean;
		paused: boolean;
	} | null;
	// Cached values for performance (computed once per render)
	usageStats: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
	};
	contextPercent: number;
	contextWindow: number;
	autoCompactEnabled: boolean;
	subagentCount: number;
	sessionStartTime: number;
	git: {
		branch: string | null;
		status: { staged: number; unstaged: number; untracked: number } | null;
	};
}

export interface RenderedSegment {
	content: string; // The segment text (may include ANSI color codes)
	visible: boolean; // Whether to render (e.g., git hidden when not in repo)
}

export interface StatusLineSegment {
	id: StatusLineSegmentId;
	render(ctx: SegmentContext): RenderedSegment;
}

// ═══════════════════════════════════════════════════════════════════════════
// Separator Definition
// ═══════════════════════════════════════════════════════════════════════════

export interface SeparatorDef {
	left: string; // Character for left→right segments
	right: string; // Character for right→left segments (reversed)
	endCaps?: {
		left: string; // Cap for right segments (points left)
		right: string; // Cap for left segments (points right)
		useBgAsFg: boolean;
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// Preset Definition
// ═══════════════════════════════════════════════════════════════════════════

export interface PresetDef {
	leftSegments: StatusLineSegmentId[];
	rightSegments: StatusLineSegmentId[];
	separator: StatusLineSeparatorStyle;
	segmentOptions?: StatusLineSegmentOptions;
}
