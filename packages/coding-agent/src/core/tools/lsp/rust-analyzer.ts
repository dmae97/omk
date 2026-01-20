import { sendNotification, sendRequest } from "./client";
import type { Diagnostic, ExpandMacroResult, LspClient, RelatedTest, Runnable, WorkspaceEdit } from "./types";
import { fileToUri } from "./utils";

/**
 * Run flycheck (cargo check) and collect diagnostics.
 * Sends rust-analyzer/runFlycheck notification and waits for diagnostics to accumulate.
 *
 * @param client - LSP client instance
 * @param file - Optional file path to check (if not provided, checks entire workspace)
 * @returns Array of all collected diagnostics
 */
export async function flycheck(client: LspClient, file?: string): Promise<Diagnostic[]> {
	const textDocument = file ? { uri: fileToUri(file) } : null;

	const countDiagnostics = (diagnostics: Map<string, Diagnostic[]>): number => {
		let count = 0;
		for (const diags of diagnostics.values()) {
			count += diags.length;
		}
		return count;
	};

	// Capture current diagnostic version before triggering flycheck
	const initialDiagnosticsVersion = client.diagnosticsVersion;
	const initialDiagnosticsCount = countDiagnostics(client.diagnostics);

	await sendNotification(client, "rust-analyzer/runFlycheck", { textDocument });

	// Bounded polling: wait for diagnostics to stabilize or timeout
	// Poll every 100ms for up to 8 seconds (80 iterations)
	const pollIntervalMs = 100;
	const maxPollIterations = 80;
	const stabilityThreshold = 3; // Consider stable after 3 iterations without change
	const minStableDurationMs = 2000; // Avoid early exit when diagnostics are re-published unchanged.
	const startTime = Date.now();
	let lastDiagnosticsVersion = initialDiagnosticsVersion;
	let lastDiagnosticsCount = initialDiagnosticsCount;
	let stableIterations = 0;

	for (let i = 0; i < maxPollIterations; i++) {
		await Bun.sleep(pollIntervalMs);

		const currentDiagnosticsVersion = client.diagnosticsVersion;
		const currentDiagnosticsCount = countDiagnostics(client.diagnostics);

		// Check if diagnostics have stabilized
		if (currentDiagnosticsVersion === lastDiagnosticsVersion && currentDiagnosticsCount === lastDiagnosticsCount) {
			stableIterations++;
			const elapsedMs = Date.now() - startTime;
			const countChangedFromStart = currentDiagnosticsCount !== initialDiagnosticsCount;
			if (
				currentDiagnosticsVersion !== initialDiagnosticsVersion &&
				stableIterations >= stabilityThreshold &&
				(countChangedFromStart || elapsedMs >= minStableDurationMs)
			) {
				break;
			}
		} else {
			stableIterations = 0;
			lastDiagnosticsVersion = currentDiagnosticsVersion;
			lastDiagnosticsCount = currentDiagnosticsCount;
		}
	}

	// Collect all diagnostics from client
	const allDiags: Diagnostic[] = [];
	for (const diags of Array.from(client.diagnostics.values())) {
		allDiags.push(...diags);
	}

	return allDiags;
}

/**
 * Expand macro at the given position.
 *
 * @param client - LSP client instance
 * @param file - File path containing the macro
 * @param line - 1-based line number
 * @param character - 1-based character offset
 * @returns ExpandMacroResult with macro name and expansion, or null if no macro at position
 */
export async function expandMacro(
	client: LspClient,
	file: string,
	line: number,
	character: number,
): Promise<ExpandMacroResult | null> {
	const result = (await sendRequest(client, "rust-analyzer/expandMacro", {
		textDocument: { uri: fileToUri(file) },
		position: { line: line - 1, character: character - 1 },
	})) as ExpandMacroResult | null;

	return result;
}

/**
 * Perform structural search and replace (SSR).
 *
 * @param client - LSP client instance
 * @param pattern - Search pattern
 * @param replacement - Replacement pattern
 * @param parseOnly - If true, returns matches only; if false, returns WorkspaceEdit to apply
 * @returns WorkspaceEdit containing matches or changes to apply
 */
export async function ssr(
	client: LspClient,
	pattern: string,
	replacement: string,
	parseOnly = true,
): Promise<WorkspaceEdit> {
	const result = (await sendRequest(client, "experimental/ssr", {
		query: `${pattern} ==>> ${replacement}`,
		parseOnly,
		textDocument: { uri: "" }, // SSR searches workspace-wide
		position: { line: 0, character: 0 },
		selections: [],
	})) as WorkspaceEdit;

	return result;
}

/**
 * Get runnables (tests, binaries, examples) for a file.
 *
 * @param client - LSP client instance
 * @param file - File path to query
 * @param line - Optional 1-based line number to get runnables at specific position
 * @returns Array of Runnable items
 */
export async function runnables(client: LspClient, file: string, line?: number): Promise<Runnable[]> {
	const params: { textDocument: { uri: string }; position?: { line: number; character: number } } = {
		textDocument: { uri: fileToUri(file) },
	};

	if (line !== undefined) {
		params.position = { line: line - 1, character: 0 };
	}

	const result = (await sendRequest(client, "experimental/runnables", params)) as Runnable[];
	return result ?? [];
}

/**
 * Get related tests for a position (e.g., tests for a function).
 *
 * @param client - LSP client instance
 * @param file - File path
 * @param line - 1-based line number
 * @param character - 1-based character offset
 * @returns Array of test runnable labels
 */
export async function relatedTests(
	client: LspClient,
	file: string,
	line: number,
	character: number,
): Promise<string[]> {
	const tests = (await sendRequest(client, "rust-analyzer/relatedTests", {
		textDocument: { uri: fileToUri(file) },
		position: { line: line - 1, character: character - 1 },
	})) as RelatedTest[];

	if (!tests?.length) return [];

	const labels: string[] = [];
	for (const t of tests) {
		if (t.runnable?.label) {
			labels.push(t.runnable.label);
		}
	}

	return labels;
}

/**
 * Reload workspace (re-index Cargo projects).
 *
 * @param client - LSP client instance
 */
export async function reloadWorkspace(client: LspClient): Promise<void> {
	await sendRequest(client, "rust-analyzer/reloadWorkspace", null);
}
