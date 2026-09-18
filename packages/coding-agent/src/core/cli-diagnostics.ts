import chalk from "chalk";
import type { AgentSessionRuntimeDiagnostic } from "./agent-session-runtime.ts";
import type { SettingsManager } from "./settings-manager.ts";

/** CLI diagnostics presentation, split out of main.ts to hold its module-size ratchet. */
export function collectSettingsDiagnostics(
	settingsManager: SettingsManager,
	context: string,
): AgentSessionRuntimeDiagnostic[] {
	return settingsManager.drainErrors().map(({ scope, error }) => ({
		type: "warning",
		message: `(${context}, ${scope} settings) ${error.message}`,
	}));
}

export function reportDiagnostics(diagnostics: readonly AgentSessionRuntimeDiagnostic[]): void {
	for (const diagnostic of diagnostics) {
		const isError = diagnostic.type === "error";
		const isWarning = diagnostic.type === "warning";
		const color = isError ? chalk.red : isWarning ? chalk.yellow : chalk.dim;
		const prefix = isError ? "Error: " : "Warning: ";
		// Diagnostic presentation is intentional stderr, not application logging.
		// pi-lens-ignore: no-console-except-error
		console.error(color(`${prefix}${diagnostic.message}`));
	}
}
