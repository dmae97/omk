import { Loader, type LoaderIndicatorOptions, type TUI } from "omk-tui";

export interface WorkingSpinnerTheme {
	fg(role: any, text: string): string;
	bold(text: string): string;
}

export interface WorkingSuffixInput {
	readonly elapsedSeconds: number;
	readonly pendingTools: number;
	readonly interruptKey: string;
	readonly expandKey: string;
	readonly toolOutputExpanded: boolean;
}

const DOT_WAVE_INDICES = [0, 1, 2, 1] as const;
const DOT_WAVE_INTERVAL_MS = 160;

/**
 * High-contrast 3-dot wave indicator tuned for dark Paper Academic themes.
 * Returns undefined when `OMK_SPINNER_STYLE=braille` opts back into the legacy braille loader.
 */
export function createReadableWorkingIndicator(
	theme: WorkingSpinnerTheme,
	env: NodeJS.ProcessEnv = process.env,
): LoaderIndicatorOptions | undefined {
	if (/^braille$/i.test(String(env.OMK_SPINNER_STYLE ?? "").trim())) return undefined;
	const active = theme.fg("accent", "●");
	const rest = theme.fg("borderMuted", "○");
	const frames = DOT_WAVE_INDICES.map((pos) => [0, 1, 2].map((i) => (i === pos ? active : rest)).join(""));
	return { frames, intervalMs: DOT_WAVE_INTERVAL_MS };
}

export function formatWorkingElapsed(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	if (s < 60) return `${s}s`;
	const hours = Math.floor(s / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	const seconds = s % 60;
	if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
	return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatWorkingSuffix(theme: WorkingSpinnerTheme, input: WorkingSuffixInput): string {
	const sep = theme.fg("borderMuted", " │ ");
	const elapsed = theme.fg("text", formatWorkingElapsed(input.elapsedSeconds));
	const segments: string[] = [elapsed];
	if (input.pendingTools > 0) {
		const label = input.pendingTools === 1 ? "1 tool" : `${input.pendingTools} tools`;
		segments.push(theme.fg("accent", label));
	}
	segments.push(theme.fg("muted", `${input.interruptKey} interrupt`));
	if (!input.toolOutputExpanded && input.pendingTools > 0) {
		segments.push(theme.fg("muted", `${input.expandKey} expand tools`));
	}
	return `  ${segments.join(sep)}`;
}

export interface WorkingLoaderOptions {
	readonly ui: TUI;
	readonly theme: WorkingSpinnerTheme;
	readonly message: string;
	readonly indicator?: LoaderIndicatorOptions;
	readonly startedAt: number;
	readonly interruptKey: string;
	readonly expandKey: string;
	readonly pendingTools: () => number;
	readonly toolOutputExpanded: () => boolean;
}

export function createInteractiveWorkingLoader(options: WorkingLoaderOptions): Loader {
	const { ui, theme, message, indicator, startedAt, interruptKey, expandKey, pendingTools, toolOutputExpanded } =
		options;
	const loader = new Loader(
		ui,
		(spinner) => theme.fg("accent", spinner),
		(text) => theme.bold(theme.fg("text", text)),
		message,
		indicator ?? createReadableWorkingIndicator(theme),
	);
	loader.setDynamicSuffix(() =>
		formatWorkingSuffix(theme, {
			elapsedSeconds: Math.max(0, Math.floor((performance.now() - startedAt) / 1000)),
			pendingTools: pendingTools(),
			interruptKey,
			expandKey,
			toolOutputExpanded: toolOutputExpanded(),
		}),
	);
	return loader;
}
