import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { classifySessionTermination } from "../src/core/session-termination.ts";
import { SessionFailureComponent } from "../src/modes/interactive/components/session-failure.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import {
	createTuiDiagnostics,
	createTuiDiagnosticsView,
	saveTuiDiagnostics,
} from "../src/modes/interactive/tui-diagnostics.ts";
import { captureTuiRuntime, inspectTuiRuntime } from "../src/modes/interactive/tui-runtime-info.ts";

const roots: string[] = [];
const runtime = captureTuiRuntime(import.meta.url);
const diagnostic = () =>
	createTuiDiagnostics({
		runtime: inspectTuiRuntime(runtime),
		columns: 80,
		rows: 24,
		isStreaming: true,
		isCompacting: true,
		messageCount: 0,
		termination: undefined,
		lastResourceReloadAt: "2026-09-12T00:00:00.000Z",
	});
const text = (view: { render(width: number): string[] }) => stripVTControlCharacters(view.render(120).join("\n"));
beforeAll(() => initTheme("dark"));
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("diagnostics boundary controls", () => {
	it("removes its owned directory and preserves the original error if serialization fails", () => {
		const root = mkdtempSync(join(tmpdir(), "omk-diagnostic-failure-"));
		roots.push(root);
		const failure = new Error("injected serialization failure");
		const report = {
			...diagnostic(),
			toJSON() {
				throw failure;
			},
		};
		expect(() => saveTuiDiagnostics(report, root)).toThrow(failure);
		expect(readdirSync(root)).toEqual([]);
	});
	it("identifies a dist entry without assigning it the source checkout revision", () => {
		const root = mkdtempSync(join(tmpdir(), "omk-diagnostic-dist-"));
		roots.push(root);
		mkdirSync(join(root, "dist"));
		const file = join(root, "dist", "interactive-mode.js");
		writeFileSync(file, "export const build = true;");
		const info = inspectTuiRuntime(captureTuiRuntime(pathToFileURL(file).href));
		expect(info.moduleKind).toBe("dist");
		expect(info.buildRevision).toBeNull();
	});
	it.each(["changed", "unavailable"] as const)(
		"makes %s inspection explicit rather than claiming freshness",
		(moduleState) => {
			const base = diagnostic();
			const view = createTuiDiagnosticsView({ ...base, runtime: { ...base.runtime, moduleState } }, runtime);
			const output = text(view);
			expect(output).toContain(moduleState === "changed" ? "restart to load code" : "not confirmed");
			expect(output).toContain("Latest outcome: none recorded");
			expect(output).toContain("Streaming: yes");
			expect(output).toContain("Compacting: yes");
			expect(output).toContain("2026-09-12T00:00:00.000Z");
		},
	);
	it("shows recorded effects on a user stop without inventing a retry", () => {
		const stop = classifySessionTermination({
			sessionId: "s",
			runId: "r",
			timestamp: "2026-09-12T00:00:00.000Z",
			source: "observed",
			cause: { area: "user", code: "abort" },
			message: "Stopped",
			sideEffects: "confirmed",
		});
		const card = new SessionFailureComponent(stop);
		card.setExpanded(true);
		expect(text(card)).toContain("Request stopped");
		expect(text(card)).toContain("Effects were recorded");
		expect(text(card)).toContain("Automatic retry: no");
	});
	it("shows the engine's safe retry flag only when side effects permit it", () => {
		const failed = classifySessionTermination({
			sessionId: "s",
			runId: "r",
			timestamp: "2026-09-12T00:00:00.000Z",
			source: "observed",
			cause: { area: "provider", code: "network" },
			message: "Network unavailable",
			sideEffects: "none",
		});
		const card = new SessionFailureComponent(failed);
		card.setExpanded(true);
		expect(failed.safeToAutoRetry).toBe(true);
		expect(text(card)).toContain("No side effects reported");
		expect(text(card)).toContain("Automatic retry: yes");
	});
});
