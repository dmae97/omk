import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Component, Container, Text } from "omk-tui";
import type { SessionTermination } from "../../core/session-termination-types.ts";
import { DynamicBorder } from "./components/dynamic-border.ts";
import { diagnosticDisplayText } from "./components/session-failure.ts";
import { theme } from "./theme/theme.ts";
import type { TuiRuntimeCapture, TuiRuntimeInfo } from "./tui-runtime-info.ts";

type DiagnosticTermination = Pick<
	SessionTermination,
	"kind" | "phase" | "causeCode" | "source" | "sideEffects" | "retryable" | "safeToAutoRetry"
>;
export interface TuiDiagnostics {
	readonly schemaVersion: 1;
	readonly privacy: "metadata-only";
	readonly generatedAt: string;
	readonly runtime: Omit<TuiRuntimeInfo, "entryPath" | "modulePath">;
	readonly terminal: { readonly columns: number; readonly rows: number };
	readonly session: {
		readonly streaming: boolean;
		readonly compacting: boolean;
		readonly messageCount: number;
		readonly lastResourceReloadAt: string | null;
	};
	readonly termination: DiagnosticTermination | null;
}

/** Project each approved field; never serialize a session, message, model, config or arbitrary error. */
export function createTuiDiagnostics(input: {
	readonly runtime: TuiRuntimeInfo;
	readonly columns: number;
	readonly rows: number;
	readonly isStreaming: boolean;
	readonly isCompacting: boolean;
	readonly messageCount: number;
	readonly lastResourceReloadAt: string | undefined;
	readonly termination: SessionTermination | undefined;
}): TuiDiagnostics {
	const r = input.runtime;
	const t = input.termination;
	return {
		schemaVersion: 1,
		privacy: "metadata-only",
		generatedAt: new Date().toISOString(),
		runtime: {
			version: r.version,
			nodeVersion: r.nodeVersion,
			platform: r.platform,
			arch: r.arch,
			capturedAt: r.capturedAt,
			moduleKind: r.moduleKind,
			moduleState: r.moduleState,
			initialModuleSha256: r.initialModuleSha256,
			currentModuleSha256: r.currentModuleSha256,
			buildRevision: r.buildRevision,
		},
		terminal: { columns: input.columns, rows: input.rows },
		session: {
			streaming: input.isStreaming,
			compacting: input.isCompacting,
			messageCount: input.messageCount,
			lastResourceReloadAt: input.lastResourceReloadAt ?? null,
		},
		termination: t
			? {
					kind: t.kind,
					phase: t.phase,
					causeCode: t.causeCode,
					source: t.source,
					sideEffects: t.sideEffects,
					retryable: t.retryable,
					safeToAutoRetry: t.safeToAutoRetry,
				}
			: null,
	};
}

export function saveTuiDiagnostics(report: TuiDiagnostics, directory = tmpdir()): string {
	const ownedDirectory = mkdtempSync(join(directory, "omk-debug-"));
	try {
		const outputPath = join(ownedDirectory, "diagnostics.json");
		writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
		return outputPath;
	} catch (error) {
		try {
			rmSync(ownedDirectory, { recursive: true, force: true });
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "Diagnostics write and cleanup failed");
		}
		throw error;
	}
}

export function createTuiDiagnosticsView(report: TuiDiagnostics, locations: TuiRuntimeCapture): Component {
	return {
		render(width: number): string[] {
			const view = new Container();
			view.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
			view.addChild(new Text(theme.fg("accent", theme.bold("OMK diagnostics")), 1, 0));
			const r = report.runtime;
			const t = report.termination;
			const moduleStatus =
				r.moduleState === "changed"
					? "changed since initialization — restart to load code"
					: r.moduleState === "unchanged"
						? "unchanged since initialization (this file only)"
						: "unavailable — not confirmed";
			const lines = [
				`Runtime: OMK ${r.version} · Node ${r.nodeVersion} · ${r.platform}/${r.arch}`,
				`Loaded UI: ${r.moduleKind} · Initialized: ${r.capturedAt}`,
				`UI file on disk: ${moduleStatus}`,
				`UI SHA256 at initialization: ${r.initialModuleSha256 ?? "unavailable"}`,
				"Build revision: unavailable (checkout HEAD is not a build identity)",
				`Last resource reload: ${report.session.lastResourceReloadAt ?? "not reloaded in this TUI"}`,
				"/reload refreshes resources, not core code. Core updates require a restart.",
				`Terminal: ${report.terminal.columns}×${report.terminal.rows} · Messages: ${report.session.messageCount}`,
				`Streaming: ${report.session.streaming ? "yes" : "no"} · Compacting: ${report.session.compacting ? "yes" : "no"}`,
				t ? `Latest outcome: ${t.kind} · ${t.causeCode} · ${t.source}` : "Latest outcome: none recorded",
				...(t
					? [
							`Effects: ${t.sideEffects} · Retryable: ${t.retryable ? "yes" : "no"} · Automatic retry: ${t.safeToAutoRetry ? "yes" : "no"}`,
						]
					: []),
				`Launch path (local only): ${locations.entryPath ?? "unavailable"}`,
				`UI module (local only): ${locations.modulePath ?? "unavailable"}`,
			];
			view.addChild(new Text(lines.map(diagnosticDisplayText).join("\n"), 1, 0));
			view.addChild(
				new Text(
					theme.fg(
						"muted",
						"Saving is explicit: /debug save writes a metadata-only JSON report locally.\nMessages, prompts, outputs, config, paths, route names and session/run IDs are excluded. No upload.",
					),
					1,
					0,
				),
			);
			view.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
			return view.render(width);
		},
		invalidate(): void {},
	};
}
